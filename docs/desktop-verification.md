# Windows 桌面适配器本机验证记录

日期：2026-11-05；Windows 交互会话 1；屏幕 3840×2160；坐标为虚拟桌面物理像素。原始证据位于未纳入 Git 的 `artifacts/desktop`、`artifacts/desktop-acceptance`、`artifacts/app-smoke`，其中截图可能包含用户界面内容，不应公开上传。

## 自动化夹具

运行 `node --test tests/desktop.test.mjs`，需要已登录且解锁的桌面，测试会显示独立 WinForms 窗口，并在结束时关闭该测试窗口。

已通过：窗口枚举、稳定窗口标识、UIA 树和属性查找、ValuePattern 写入中文、InvokePattern 按钮操作、状态等待及超时、Unicode 键盘输入、组合键、真实鼠标点击、屏幕布局变化拒绝、窗口 PNG、两个独立真实触摸联系人、无效轨迹拒绝、窗口关闭后的过期引用拒绝。

两指触摸验收读取应用收到的 `WM_TOUCH`，没有把鼠标事件或仅注入 API 成功作为触摸成功。证据：`artifacts/desktop/fixture.log`、`fixture.log.png`、`window.png`。

## 三类实际应用

| 应用 | 版本 | 查询与操作结果 | 证据 |
| --- | --- | --- | --- |
| 希沃白板 5（原生） | 5.2.4.11610 | 读到 126 个 UIA 节点；按名称找到“刷新”按钮，InvokePattern 成功，操作后重新读取树和截图 | `app-smoke/native-tree.json`、`native-interaction.json`、`native-after.png` |
| EasiClass（Electron） | 1.0.14.659 | 初始读到 60 个 UIA 节点；按名称找到“背景设置”按钮，Invoke 请求未在 20 秒内结束；重新观察后采用截图坐标与真实鼠标点击，背景设置弹窗实际出现，随后点击关闭，未更改背景 | `app-smoke/electron-tree.json`、`electron-interaction.json`、`electron-visual-fallback.png` |
| 鸿镜（Flutter） | 1.0.3+3 | 读到 29 个 UIA 节点；按名称找到“刷新设备列表”，InvokePattern 成功，操作后重新读取树和截图。界面处于未连接设备状态 | `app-smoke/flutter-tree.json`、`flutter-interaction.json`、`flutter-after.png` |

这些是实际应用的安全冒烟流程，不代表三类应用所有关键业务流程均已验收。Electron 的 Invoke 未确认执行结果，不能标记成功；视觉兜底成功也不能替代完整控件操作验收。鸿镜设备投屏业务需要可连接设备。

## 10 指 30 秒／60 Hz

显式运行 `node tests/desktop-acceptance.mjs`。2026-11-05 22:22:40 至 22:23:10（Asia/Shanghai）进行了一次与录屏并行的探测：

- 发送 1,801 帧，包含 18,010 个触点样本，最大同时 10 指；1800 个采样帧及最后抬起帧。
- `InjectSyntheticPointerInput` 全部返回成功，执行加设备释放耗时 30,205.58 ms，最大观测延迟 23.10 ms，未报告丢弃样本或减少触点。
- 测试应用收到的触摸联系人和触摸事件均为 0，画布没有笔迹。因此 A04、A05 **未通过**。
- 单指和两指可以收到真实触摸。三指及以上疑似受到 Windows 手势路由影响，尚未证明根因；未修改用户全局手势设置。

原始结果：`artifacts/desktop-acceptance/report.json`、`touch.log`、`after.png`。必须分别评估输入接口、应用实际事件与笔迹完整性，不得把注入成功当作书写验收通过。

## 已知边界

- Windows 可能拒绝将后台应用激活为前台，返回 `FOCUS_DENIED`。客户端应观察实际前台状态，不能因已发出请求便假定焦点成功。
- UIA Provider 可能阻塞；服务端应给子进程设置超时，标记结果未知并重新观察，禁止盲目重试有副作用动作。
- `input.key` 的 `down` 是有上限的保持任务，默认保持 1000 ms，可设置 `holdMs`（最多 300000 ms），正常结束或取消时释放；不能靠一次已结束的短请求无限保持键。
- `input.touch` 由独立合成设备执行，结束/异常时释放联系人并销毁设备。`cancelFile` 由服务端控制，用于断开/取消后的清理。
- 截图返回原始尺寸、坐标映射与 `layoutId`；使用旧 `layoutId` 的坐标操作会拒绝执行。尚未覆盖真实多显示器混合 DPI 和横竖屏切换。
- 当前只验证此台 Windows，不能推导所有支持版本、不同显卡及不同 UIA Provider 均通过。

参考：[Microsoft 合成指针设备](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-createsyntheticpointerdevice)、[触摸注入契约](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-injecttouchinput)。
