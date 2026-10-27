#!/usr/bin/env python
"""直接调 ComfyUI 的 /prompt 接口出一张 SDXL 图。

用法: python comfy_gen.py "提示词" [输出路径] [--steps 28] [--size 1024] [--server http://127.0.0.1:8188]
成功时打印输出文件的绝对路径。
"""
import argparse
import json
import os
import random
import sys
import time
import urllib.request

NEGATIVE = "lowres, blurry, text, watermark, extra fingers, deformed, worst quality"


def post_json(url, payload):
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def get_json(url):
    with urllib.request.urlopen(url, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("prompt")
    ap.add_argument("output", nargs="?", default=None)
    ap.add_argument("--steps", type=int, default=28)
    ap.add_argument("--size", type=int, default=1024)
    ap.add_argument("--server", default="http://127.0.0.1:8188")
    ap.add_argument("--seed", type=int, default=None)
    ap.add_argument("--init", default=None, help="本地图片路径：以图生图（需要 ComfyUI 能访问该文件）")
    ap.add_argument("--denoise", type=float, default=0.6, help="img2img 强度，0.4-0.8")
    ap.add_argument("--negative", default=None, help="覆盖默认负面词")
    ap.add_argument("--cfg", type=float, default=7.0, help="提示词跟随强度，越大越听话")
    ap.add_argument("--lora", default=None, help="ComfyUI models/loras 目录里的 LoRA 文件名")
    ap.add_argument("--lora-weight", type=float, default=0.8, help="LoRA 权重，0-1.5")
    args = ap.parse_args()

    seed = args.seed if args.seed is not None else random.randint(1, 2**31 - 1)
    graph = {
        "4": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "sd_xl_base_1.0.safetensors"}},
        "6": {"class_type": "CLIPTextEncode", "inputs": {"text": args.prompt, "clip": ["4", 1]}},
        "7": {"class_type": "CLIPTextEncode", "inputs": {"text": args.negative or NEGATIVE, "clip": ["4", 1]}},
        "5": {"class_type": "EmptyLatentImage", "inputs": {"width": args.size, "height": args.size, "batch_size": 1}},
        "3": {
            "class_type": "KSampler",
            "inputs": {
                "seed": seed,
                "steps": args.steps,
                "cfg": args.cfg,
                "sampler_name": "dpmpp_2m",
                "scheduler": "karras",
                "denoise": 1.0,
                "model": ["4", 0],
                "positive": ["6", 0],
                "negative": ["7", 0],
                "latent_image": ["5", 0],
            },
        },
        "8": {"class_type": "VAEDecode", "inputs": {"samples": ["3", 0], "vae": ["4", 2]}},
        "9": {"class_type": "SaveImage", "inputs": {"filename_prefix": "dsh_comfy", "images": ["8", 0]}},
    }

    if args.lora:
        # 训练出来的 LoRA 要先放进 ComfyUI 的 models/loras，这里只按文件名引用。
        graph["12"] = {
            "class_type": "LoraLoader",
            "inputs": {
                "lora_name": args.lora,
                "strength_model": args.lora_weight,
                "strength_clip": args.lora_weight,
                "model": ["4", 0],
                "clip": ["4", 1],
            },
        }
        graph["6"]["inputs"]["clip"] = ["12", 1]
        graph["7"]["inputs"]["clip"] = ["12", 1]
        graph["3"]["inputs"]["model"] = ["12", 0]

    if args.init:
        # 图生图：先把原图编码进 latent，再让 KSampler 从 --denoise 开始重画。
        graph["10"] = {"class_type": "LoadImage", "inputs": {"image": args.init}}
        graph["11"] = {"class_type": "VAEEncode", "inputs": {"pixels": ["10", 0], "vae": ["4", 2]}}
        graph["3"]["inputs"]["latent_image"] = ["11", 0]
        graph["3"]["inputs"]["denoise"] = args.denoise
    else:
        graph["3"]["inputs"]["denoise"] = 1.0

    queued = post_json(f"{args.server}/prompt", {"prompt": graph})
    prompt_id = queued.get("prompt_id")
    if not prompt_id:
        print(f"queue failed: {queued}", file=sys.stderr)
        return 1

    deadline = time.time() + 600
    image_ref = None
    while time.time() < deadline:
        time.sleep(2)
        history = get_json(f"{args.server}/history/{prompt_id}")
        entry = history.get(prompt_id)
        if not entry:
            continue
        status = entry.get("status", {})
        if status.get("status_str") == "error":
            print(f"generation error: {status}", file=sys.stderr)
            return 1
        outputs = entry.get("outputs", {})
        images = outputs.get("9", {}).get("images") or []
        if images:
            image_ref = images[0]
            break
    if not image_ref:
        print("timed out waiting for image", file=sys.stderr)
        return 1

    query = urllib.parse.urlencode({"filename": image_ref["filename"], "subfolder": image_ref.get("subfolder", ""), "type": image_ref.get("type", "output")})
    with urllib.request.urlopen(f"{args.server}/view?{query}", timeout=60) as resp:
        blob = resp.read()

    out = args.output or os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "pics", f"comfy-{int(time.time())}.png")
    out = os.path.abspath(out)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "wb") as fh:
        fh.write(blob)

    print(out)
    return 0


if __name__ == "__main__":
    import urllib.parse  # noqa: E402  (used above)

    raise SystemExit(main())
