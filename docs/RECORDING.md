# Windows 无声录屏

Windows 10 22H2（19045）与 Windows 11 x64 服务端默认使用系统原生录屏：DXGI Desktop Duplication → D3D11 视频处理 → Media Foundation H.264 → MP4。所有服务端包都包含预编译 CaptureHost，无需 FFmpeg；不采集系统声音或麦克风。

客户端命令保持不变：

```sh
wdb record start --args '{"durationSeconds":10,"fps":30,"monitor":0}'
wdb record start --args '{"durationSeconds":10,"encoder":"software"}'
wdb record stop --args '{"id":"<录制任务ID>"}'
```

Windows PowerShell 可将 JSON 写入文件后使用 `--args-file`，避免 shell 引号差异。输出固定 1920×1080、SDR、等比缩放补边，帧率范围 1..60，默认 30，时长范围 1..3600 秒，默认 600 秒。实际帧率取决于设备，结果包含实际解码帧数、时长、编码器硬件标记与像素转换方式；硬件状态无法确认时为 null。

通过 `info` 的 `media` 查询当前桌面能力。录屏只能在已登录普通用户的可用桌面执行；一个 helper 同时仅允许一项录制。锁屏、显示器切换、设备丢失、受保护内容和未支持的 HDR 色彩空间会明确失败，不跨用户或安全桌面继续录制。Windows N/精简系统缺媒体组件时返回能力不可用，其他功能不受影响。

含 FFmpeg 的安装包支持显式 `backend:"ffmpeg"`；多屏时该后端还要求明确的 `captureIndex`，不要把 UI 屏幕序号等同于 DXGI 输出序号。不含 FFmpeg 的包拒绝该选择，不自动下载或从 PATH 搜索 FFmpeg。

录制任务断开客户端后继续至配置时限；取消用 `task cancel`，正常提前停止用 `record stop`。服务重启时原任务可能为 unknown，先查询任务，不能自动重录。停止会等待封装完成；完成的 MP4 通过已有 `pull` 下载。原生后端在完成前用系统解码器完整验证文件、确认 H.264 和零音轨。异常退出留下的 partial 文件不代表完整视频。

截图继续使用已有原生桌面桥。本功能用于调试取证，不提供实时视频串流。
