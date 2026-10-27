# 在 8G 显卡的 Windows 上，把 AI 图 / 语音 / B 站自动化跑通的踩坑记录

写这份东西的原因很简单：下面每一条，都是我这两天真的撞上、真的修好的。报错原文我都留下了，你搜那段字就能直接找到这一节。

环境：Windows 10/11、RTX 5060 8GB、32GB 内存、Python 3.12、无管理员常规权限。
（有钱有 24G 卡的人用不上这里的大半内容。）

---

## 一、ComfyUI + SDXL 本地出图

### 1. 装的时候别装全家桶

源码用官方的 tar 包（比 git clone 稳，也能断点续）：

```bash
curl -L -o comfyui.tar.gz https://codeload.github.com/comfyanonymous/ComfyUI/tar.gz/refs/heads/master
```

依赖装进现成的 venv 时，`comfyui-workflow-templates-media-assets-02==0.1.23` 在清华源上是找不到的（`No matching distribution found`）——那是编辑 UI 用的资源包，不装也不影响跑图，跳过它。

但这两样必须装，少一个都起不来：

```bash
pip install comfyui-frontend-package==1.57.4
```

不装它会直接退出，报 `comfyui-frontend-package is not installed.`——**注意它退出时几乎不解释，看着像程序卡住**。

### 2. torch 被偷偷换成 CPU 版

装 `torchvision` / `kornia` 的时候，pip 会顺手把 torch 换成 PyPI 上的 CPU 版（2.14.1+cpu），然后你得到的是一个能跑但慢到怀疑人生的环境，而且**之前装好的语音环境也一起坏掉**（torchaudio 版本对不上）。

钉死版本，并只用 CUDA 索引：

```bash
pip install torch==2.9.1+cu128 torchvision==0.24.1+cu128 torchaudio==2.9.1+cu128 \
  --index-url https://mirrors.nju.edu.cn/pytorch/whl/cu128
```

`download.pytorch.org` 在国内实测 0 B/s；`mirrors.nju.edu.cn` 能到 4 MB/s。

### 3. 出图脚本的几个参数（真的很影响结果）

我用的最小 SDXL 图：`CheckpointLoaderSimple → CLIPTextEncode ×2 → EmptyLatentImage → KSampler(dpmpp_2m / karras) → VAEDecode → SaveImage`，28 步、1024×1024。

想让表情包「有表情」，这三条是硬条件：

1. **表情词放在提示词最前面**，别埋在一堆画质词后面；
2. `cfg` 提到 8.5（默认 7 时写 angry 出平静脸）；
3. 图生图 `denoise` 0.8 左右——0.6 只够换衣服，换不了表情。

还有一条血的教训：**参考图里的文字会跟着跑进结果**。我拿一张带气泡的表情当垫图，五张成品全带着同一团乱码。负面词里加 `text, speech bubble, watermark`。

---

## 二、8G 显卡训 SDXL LoRA（这一步最容易翻车）

### 1. 55 秒一步，真凶不是显存

我用 sd-scripts 的 `sdxl_train_network.py`，命令行写了 `--resolution 256,256`，结果跑出来 55 s/it，以为是显卡不行。

真凶在 `dataset.toml`：

```toml
[[datasets]]
resolution = [768, 768]
max_bucket_reso = 1024
```

**数据集配置里的 resolution 会盖掉命令行参数**。所谓「256 探针」其实一直在 768–1024 训。改成 `[512, 512]` / `max_bucket_reso = 768`，立刻变成 17 s/it。

### 2. `WinError 1455`：不是显存，是页面文件

```
OSError: [WinError 1455] 页面文件太小，无法完成操作。
Error loading "...\torch\lib\cufft64_11.dll" or one of its dependencies.
```

这台机器 32GB 内存，但系统自动管理的页面文件只有 5.7GB，提交上限 37.4GB，用掉 37.0GB。训练的数据加载子进程每个都要重新 `import torch`，一撞上限就崩在加载 DLL 这一步——**报错看着像 CUDA 坏了，其实是内存**。

两步解决：

- 把页面文件调到 32GB（需要管理员，附的 `set-pagefile.ps1`，`Start-Process -Verb RunAs` 提权跑，改完立刻生效不用重启）；
- 训练加 `--max_data_loader_n_workers 0`，单进程加载。

### 3. 几个会直接报错的参数

| 现象 | 原因 |
| --- | --- |
| `error: unrecognized arguments: --lowvram` | `sdxl_train_network.py` 只认 `--lowram` / `--highvram` |
| `AssertionError: when caching Text Encoder output, either caption_dropout_rate, shuffle_caption, ...` | 开了 `--cache_text_encoder_outputs` 就不能在 dataset.toml 里写 `shuffle_caption` / `keep_tokens` |
| `torch.OutOfMemoryError ... 12.83 GiB is allocated` | 没开 `--full_fp16`，主权重是 fp32 的 |
| 第 0 步 `CUBLAS_STATUS_INTERNAL_ERROR` | 多半是上面第 2 条的提交内存问题在别的进程里冒出来 |

> 另外：`--lowram` 能让它跑起来，但会一直换页，17→79 s/it，等于不能用。8G 卡就老老实实 512 分辨率 + `--full_fp16` + `--gradient_checkpointing` + `--sdpa`。

### 4. 让训练活过自己的重启

训练挂在自己的进程树里，一次重启就没了。`schtasks /create` 在非管理员账户下会返回 `ERROR: Access is denied.`，改用 WMI：

```powershell
Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
  CommandLine = 'cmd.exe /c D:\path\run_train.cmd full'
}
```

这样父进程是 WMI 服务，不在你的会话作业对象里，重启 GUI 也不会带走它。

**别按进程名杀进程。** 我干过一次 `Get-Process python | Stop-Process -Force`，把用户自己的本地代理一起杀了，他的网直接断——因为代理也挂在 `127.0.0.1` 上，而系统代理设置还指着那个已经没了的端口。要杀就核对了命令行再按 PID 杀。

---

## 三、Windows 上装抽帧 / ASR

- `pypi.org` 直连会出现「11 秒能访问但 pip 零进度」的假死，换清华镜像；pip 还卡在 `Looking in indexes` 的话，加 `--no-cache-dir`（HTTP 缓存导致的）。
- `huggingface.co` 不通 → `hf-mirror.com`（会 429，限速 0.7MB/s）或 `www.modelscope.cn`（2.4 MB/s，稳）。模型下完**校验 sha256**，别信「看着下完了」。
- faster-whisper 的模型不是「放个文件夹就行」，路径要指到含 `model.bin` 的那一层。

---

## 四、给 DSH 的 `dsh-im` 加图片投递

DSH 的 IM 插件默认只能发文字，Web 里能看的图到了 QQ 是空框。补丁思路：

1. 插件的 `plugin-src/host/` 里，`delivery-service.mjs` 加 `sendImage`（校验扩展名、≤20MB）；
2. `delivery-adapter.mjs` 加 `sendImage` → `coreController.sendProactiveImage`；
3. `delivery-rpc.mjs` 的 `send` 端点白名单加 `image`；
4. `src/channels/qq/qq-controller.mjs` / `qq-runtime.mjs` 补 `sendProactiveImage`。

两个实操细节：

- `lib/index.js` 被运行中的进程占用，esbuild 直接写会 `Access is denied` → 先写 `lib/index.new.js` 再 `Move-Item -Force` 覆盖；
- 插件重装会把这些改动冲掉，所以补丁脚本要幂等（附的 `patch-im.mjs`），重装后跑一遍再 `build-im.mjs` 重建。

---

## 五、本地 GPT-SoVITS（女声）

- 依赖必须钉：`numpy==1.26.4`、`transformers==4.57.1`、`tokenizers==0.22.1`、`librosa==0.10.2`、`pytorch-lightning 2.6.6`、`x-transformers 2.31.10`。
- `jieba_fast` 没有 cp312 的 wheel（要 MSVC），写个 shim 转给 `jieba` 就行。
- torchaudio 2.9 的 `load()` 需要 torchcodec：在脚本里 monkeypatch 成 `soundfile.read`。
- `fast_langdetect` 需要 `GPT_SoVITS/pretrained_models/fast_langdetect` 这个目录存在，空目录也行。

---

## 六、B 站自动化（只用公开接口 + cookie）

| 想干的事 | 接口 | 坑 |
| --- | --- | --- |
| 点赞 | `POST /x/web-interface/archive/like` | `/x/v2/view/like` 返回 404 HTML，别用 |
| 收藏 | `POST /x/v3/fav/resource/deal`（`rid`=aid，`type`=2，`add_media_ids`，`csrf`） | `bilibili_api` 的 `.add(fid)` 会报「视频收藏夹需要 media_id」，参数名对不上 |
| 查评论里的 @ 是否生效 | `GET /x/v2/reply/detail` 或评论列表，看 `content.members` | 正文里写 `@昵称` 不一定生成 mention，必须看 members 里有没有那个 uname |

---

## 最后

这些坑没有一个是「知识点」，全是撞出来的。谁的机器跟我一样只有 8G 显存，就能省下这两天。

（附带的 `kit/` 里是脚本原件：`set-pagefile.ps1`、`run_train.cmd`、`comfy_gen.py`、`patch-im.mjs`、`build-im.mjs`。都是我自己在用的，改路径即可。）

---

## 附：脚本

同仓库根目录下就是我在用的原件：set-pagefile.ps1（改页面文件，需管理员）、un_train.cmd（8G 卡的训练参数）、dataset.toml（数据集配置）、comfy_gen.py（ComfyUI 出图 + 图生图）、patch-im.mjs / uild-im.mjs（DSH 的 IM 插件图片补丁）、send-qq-image.mjs。

路径里的 `C:\ai` 是占位，改成你自己的目录。