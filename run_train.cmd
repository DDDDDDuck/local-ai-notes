@echo off
rem 把下面的 C:\ai 换成你自己的目录（这行之后所有路径都跟着它走）。
setlocal
rem Detached LoRA training runner. Usage: run_train.cmd probe | run_train.cmd full
rem This file must be launched by schtasks (or Start-Process), never as a child of the agent loop.

set MODE=%1
if "%MODE%"=="" set MODE=probe

set VENV=C:\ai\.lora
set SDS=C:\ai\lora\sd-scripts
set RUNS=C:\ai\lora\runs
set CKPT=C:\ai\models\checkpoints\sd_xl_base_1.0.safetensors
set DS=C:\ai\lora\dataset.toml
set OUT=C:\ai\lora\out

if not exist "%RUNS%" mkdir "%RUNS%"

set STAMP=%DATE:~0,4%%DATE:~5,2%%DATE:~8,2%-%TIME:~0,2%%TIME:~3,2%%TIME:~6,2%
set STAMP=%STAMP: =0%
set LOG=%RUNS%\%STAMP%-%MODE%.log

set TMP=C:\ai\.tmp2
set TEMP=C:\ai\.tmp2
set PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True
set HF_HOME=C:\ai\.hf-cache
set HF_HUB_OFFLINE=1
set TRANSFORMERS_OFFLINE=1
set PYTHONPATH=%SDS%

cd /d "%SDS%"

if /I "%MODE%"=="probe" (
  set STEPS=3
  set RES=256,256
  set DIM=4
  set ALPHA=2
  set NAME=probe
) else (
  set STEPS=800
  set RES=512,512
  set DIM=16
  set ALPHA=8
  set NAME=jingwhale_sdxl
)

echo [%STAMP%] mode=%MODE% steps=%STEPS% res=%RES% dim=%DIM% > "%LOG%"

"%VENV%\Scripts\python.exe" sdxl_train_network.py ^
  --pretrained_model_name_or_path="%CKPT%" ^
  --dataset_config="%DS%" ^
  --output_dir="%OUT%" ^
  --output_name=%NAME% ^
  --network_module=networks.lora ^
  --network_dim=%DIM% --network_alpha=%ALPHA% ^
  --resolution=%RES% --train_batch_size=1 ^
  --max_train_steps=%STEPS% --learning_rate=1e-4 --unet_lr=1e-4 ^
  --lr_scheduler=cosine --lr_warmup_steps=3 ^
  --optimizer_type=AdamW8bit ^
  --mixed_precision=fp16 --full_fp16 ^
  --gradient_checkpointing --network_train_unet_only --no_half_vae ^
  --sdpa --max_data_loader_n_workers 0 ^
  --seed=42 >> "%LOG%" 2>&1

echo EXITCODE=%ERRORLEVEL% >> "%LOG%"
endlocal
