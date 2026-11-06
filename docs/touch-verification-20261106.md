# Windows 模拟触摸复验

2026-11-06，Windows 11 Pro build 28000，当前设备无实体触摸屏。测试使用自建 WinForms 画布读取真实 `WM_TOUCH` 并绘制笔迹；不代表希沃、Electron 或 Flutter 业务画布已完成 10 指验收，也不替代触摸硬件测试。

## 根因与对照

逐点 `WindowFromPoint` 验证所有初始落点命中测试画布，前后均验证前台窗口，并保存实际可见桌面截图。排除了此前探针未确认焦点的问题。

| 系统“三指和四指的触摸手势” | 输入 | 应用实际收到 |
|---|---|---|
| On（原设置） | 1 / 2 指，2 秒 | 1 / 2 个联系人完整按下、移动、抬起 |
| On | 3 / 5 / 10 指，2 秒 | 0 个事件，注入 API 仍返回成功 |
| On | 改用 InjectTouchInput 对照，10 指 | 0 个事件，排除仅更换注入 API 即可解决 |
| Off（临时） | 同一合成指针接口，10 指，2 秒 | 10 个 DOWN、10 个 UP 对应的独立联系人，画布出现 10 条笔迹 |
| Off | CLI + SYSTEM 服务 + 用户助手，10 指 30 秒，与录屏并行 | 通过，详见下文 |
| Off | CLI，10 指交叉轨迹、错峰按下及抬起，4 秒 | 通过；最大同时 10 指，240 帧 / 1,860 个样本，10 个联系人均释放 |
| On（恢复原设置） | 再次执行相同 10 指短测 | 再次收到 0 个事件；探针按预期退出 1 |

该 On → Off → On 对照确认本机的阻断来自系统多指手势设置。通过 Windows 设置界面及 UIA TogglePattern 临时切换，结束后读取确认已恢复 **On**；没有修改注册表或永久关闭系统手势。CLI 的触摸注入函数本身不更改该设置。

微软说明 Windows 11 默认会由系统接管三、四指交互；需要应用处理时关闭相应开关：[触摸开发指南](https://learn.microsoft.com/en-us/windows/apps/develop/input/touch-developer-guide)。本机进一步观测到 5/10 指也受此开关影响，该扩展结论来自上述实测，不泛化到所有 Windows 版本。

## 30 秒并行结果

- 09:28:54 至 09:29:26，通过 localhost CLI 提交 `input.touch`；任务 `bb6a85c2-bb35-4bca-a591-815fcbb88251`。完整轨迹在用户助手本地执行，不逐点网络往返。
- 10 指同时落笔，持续 30 秒，每指 60 Hz；1,801 帧 / 18,010 个触点样本（含最后 UP 帧），没有静默减少触点或丢弃输入帧。适配器耗时 30,205.38 ms（含释放），最大观测延迟 16.50 ms，not-ready 重试 0。
- 应用收到 18,100 个 WM_TOUCH 联系人事件，10 个独立 DOWN 联系人和 10 个独立 UP 联系人。事件数并非输入样本数的逐项映射；笔迹另行检查。
- 实际可见截图及录像末帧均显示 10 条独立、连续的曲线，从起点到终点完整。交叉/错峰短测另有 10 条交叉笔迹截图。
- 录像任务 `a3a1a8a0-83b2-43ec-a79e-fcbf9d9c711f`：H.264、1920×1080、35 秒、1,050 帧、平均及名义 30 fps；编码器记录重复帧 1、丢弃帧 0。完整解码退出 0，已通过 CLI pull 取回，SHA-256：`7d35ebb2e2761baf0b419ca00c42a819397f9aa05c80ee27778dd65c9ca65969`。

证据目录：`artifacts/desktop-acceptance-cli-10finger-recording/`（`report.json`、`touch.log`、`visible-after.png`、`recording.mp4`、`recording-end.png`）、`artifacts/desktop-acceptance-cli-cross-stagger/`、`artifacts/desktop-acceptance-restored-on-10/`。开关读数保存在 `artifacts/touch-gesture-before.json`、`touch-gesture-off.json`、`touch-gesture-restored.json`。

## 复现

保持桌面登录且解锁，测试期间不要人工操作键鼠。先在 `ms-settings:devices-touch` 记录原始开关状态，临时关闭三、四指手势。设置以下环境变量后运行：

```powershell
$env:WDB_ACCEPTANCE_CLI = '1'
$env:WDB_ACCEPTANCE_RECORD = '1'
$env:WDB_ACCEPTANCE_LABEL = 'cli-10finger-recording'
node tests/desktop-acceptance.mjs
```

默认 10 指 / 30 秒 / 60 Hz。短测可设置 `WDB_TOUCH_FINGERS`、`WDB_TOUCH_DURATION_MS`；交叉错峰用 `WDB_TOUCH_PROFILE=cross-stagger` 且时长至少 4 秒。结束后恢复原系统开关状态。探针不会自行更改系统偏好，实际应用交付失败会保留证据并以非零退出。
