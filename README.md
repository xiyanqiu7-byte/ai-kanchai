# AI砍柴

桌面端 AI 辅助砍柴工具：导入成片 → 从画面点选角色建档 → 自动标出角色镜头 → 快速确认与命名 → 批量导出 MP4。

## 功能（MVP）

- 拖拽 / 打开本地视频（mkv/mp4 等，解码依赖本机 ffmpeg）
- 暂停画面点选人脸建档（造型名写入导出文件名）
- 镜头切分 + 人脸匹配 + 前后缓冲，生成候选片段
- 右侧片段列表：保留/排除、日夜、造型、剧情简述
- 文件名模板：`{集数}-{镜号}{日/夜}·{造型}·{简述}.mp4`
- 快捷键：空格 / J K L / `,` `.` / I O / E 建档 / A 分析 / Backspace 删除

## 环境要求

- Node.js 20+
- Python 3.10+
- ffmpeg / ffprobe 在 PATH 中
- Windows 可打包为 exe（朋友试用）

## 安装

```bash
cd ai-kanchai
npm install
python3 -m pip install -r analyzer/requirements.txt
```

人脸模型已放在 `analyzer/models/`（YuNet + SFace）。若缺失，可从 [opencv_zoo](https://github.com/opencv/opencv_zoo) 下载同名 onnx。

## 开发运行

```bash
# 终端 1：可选，Electron 启动时会自动拉起分析服务
npm run dev:analyzer

# 终端 2：Vite + Electron
npm run dev
```

仅调试界面（无桌面桥接）：

```bash
npm run dev:web
```

## 打包 Windows exe

在 Windows 机器上：

```bash
npm run dist
```

产物在 `release/`。当前会把 `analyzer/` 打进 `resources`，目标机器仍需安装 **Python3 + 依赖 + ffmpeg**。后续可再做成嵌入式 Python 运行时。

## 建议工作流

1. 打开成片，填写集数  
2. 播到角色正脸，按 `E`，点击人脸建档，填写造型（如「粗布麻衣」）  
3. 按 `A` 开始分析，等待候选段出现在右侧  
4. 逐段确认：排除误检、用 I/O 微调、填写日/夜与简述  
5. 导出 MP4  

## 技术结构

- `electron/` Electron 主进程与 preload  
- `src/` React 界面  
- `analyzer/` Python FastAPI：切镜、人脸、导出  

对话关联 / 声纹相关镜为 V2，尚未实现。
