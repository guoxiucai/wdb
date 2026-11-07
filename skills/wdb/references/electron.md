# Electron UI 调试

WDB 在原有 UIA、截图和 Windows 输入能力上增加 CDP。所有操作仍通过 `CLI → 已配对的 HTTPS 服务 → 登录用户桌面助手` 执行；CLI 不直接连接 Electron，目标电脑不需要向客户端开放调试端口。

## 启动与选择

```powershell
wdb electron launch 'C:\Apps\EasiClass\EasiClass.exe' --port 19222 --json
wdb electron targets --endpoint http://127.0.0.1:19222 --json
wdb windows list --process EasiClass --json
```

替换为实际安装路径。`launch` 添加 `--remote-debugging-address=127.0.0.1`、`--remote-debugging-port` 和 `--force-renderer-accessibility`；不修改安装包。额外启动参数用 `--arguments '["--test-mode"]'`。端口已被占用会拒绝启动，不附着到不明进程。若应用已运行，单实例机制可能忽略新参数，应正常退出后重新启动；不要重复启动来碰运气。`cdpAvailable:false` 表示程序已启动但尚未发现页面，不算 CDP 验证通过。

CDP 端点只接受服务端回环 HTTP 地址，例如 `http://127.0.0.1:19222`。多个页面时必须提供 `--target <targets返回的id>`；启动加载页与业务页面可能同时存在，应按返回的 URL/标题明确选择。每次命令重新发现并连接指定目标，不自动切换到另一页面。

将观察得到的参数保存为 `electron-session.json`，供后续命令复用：

```json
{
  "endpoint": "http://127.0.0.1:19222",
  "target": "<实际页面ID>",
  "window": "<windows list 返回的完整窗口ID>"
}
```

页面 ID 与窗口 ID 是两种不同标识，均需来自当前观察。应用重启后重新获取。操作要求桌面登录且解锁。

## 观察、操作和结果确认

```powershell
wdb electron observe --args-file electron-session.json --json
wdb electron tree --args-file electron-session.json --json
wdb electron find --args-file electron-session.json --selector '[data-testid="settings"]' --json
wdb electron action --args-file electron-session.json --backend cdp --selector '[data-testid="settings"]' --action click --json
wdb electron wait --args-file electron-session.json --selector '[role="dialog"]' --state visible --timeoutMs 5000 --json
wdb electron screenshot --args-file electron-session.json --json
```

- `observe` 汇总 CDP 控件、UIA 控件和桌面截图，各自返回 `ok` 与错误；某通道不可用不阻塞其他观察。省略 `window` 时 UIA 标为不可用，视觉截图覆盖整个桌面。截图默认按窗口捕获；提供 `region:{x,y,width,height}` 可获取实际可见区域。
- `tree` 返回当前文档和开放 Shadow DOM 中的控件摘要，包含名称、HTML 标签、class、id、`data-testid`、状态及边界；并非完整 DOM 或完整可访问性树。默认只列常见交互元素，非语义自定义控件可用 `--selector` 查询，或用 `eval` 检查 DOM。`--name` 是精确名称匹配，使用 aria-label、aria-labelledby、label、可见文本等简化规则，不声称实现完整可访问名称标准。
- `find`/`action` 支持 CSS `selector`、精确 `name`，两者可组合。操作遇到多个匹配返回 `AMBIGUOUS_CONTROL`；禁用或被其他元素遮挡的控件会拒绝操作。
- CDP `action` 支持 `click`、`fill`、`type`；输入内容用 `--text` 或 JSON `text`。通过 `CDP.Input` 发出页面鼠标/输入事件。`fill` 聚焦后通过 DOM 选择目标字段内容，再用 `Input.insertText` 替换，空字符串表示清空；避免应用全局 Ctrl+A/Backspace 快捷键拦截。`type` 在当前光标位置插入。不将 JavaScript 的 `element.click()` 当作真实 Windows 鼠标输入。
- `wait` 支持 `visible`、`hidden`、`attached`、`detached`，必须给出 selector/name。等待无副作用，但操作不会因等待失败而自动重放。
- `eval --expression <JavaScript>` 或 `--expression-file <本地js文件>` 在选定页面执行脚本并返回可序列化值。可以修改页面，不能当作只读命令；脚本异常或失联可能发生在部分代码执行后。
- `logs --durationMs 2000 --limit 200` 收集有界的页面 console/异常及可用的 Chromium Log 事件，保存 JSON；默认监听1秒，最长60秒。它不是应用全量历史日志，也不默认采集网络内容。

成功发出操作会返回 `needsObservation:true`。随后使用 `wait`、`find`、`eval` 或截图核实实际业务结果。截图、console 和协议诊断文件位于任务目录，可通过 `wdb pull <artifact.path> <本地路径>` 取回。

## UIA 与视觉兜底

`electron action --backend uia` 接收 `ui find` 返回的完整 `reference`；也可以提供 `window` 与 `name` / `automationId` / `controlType` 重新定位。`click` 映射为 Invoke，`fill` 映射为 ValuePattern。其他 UIA 操作沿用 `ui action` 的 `invoke/value/toggle/select/expand/collapse/focus`。UIA 运行在独立 MTA 线程；新 reference 携带查询提示缩小查找范围，同时继续核对 runtime ID。超时/取消后，在真正执行动作前重新检查取消状态。

视觉通道使用已观察截图中的物理桌面坐标。例如以下 JSON 配合 `electron action --args-file visual.json`：

```json
{
  "backend": "visual",
  "window": "<实际窗口ID>",
  "action": "click",
  "x": 500,
  "y": 300,
  "layoutId": "<最新桌面截图返回的layoutId>"
}
```

WDB 会检查屏幕布局、前台窗口和点击落点所属窗口，再发送真实 Windows 鼠标输入。`FOCUS_DENIED` 时需先激活目标应用并重新观察，不能把焦点请求当作已经成功。视觉识别与坐标选择由 Agent 完成，WDB 不内置识图模型。截图缩略图坐标必须映射回原图；CDP 返回的 `css-viewport` 坐标不能直接当作 `virtual-desktop-physical`。CDP 截图的 `page-image-pixels` 也不能直接用于桌面点击。

`backend:auto`（action 默认）先尝试 CDP，提供 window/reference 时可继续 UIA，提供明确的 `visual:{x,y,layoutId}` 时才允许视觉兜底。只对已确认未执行的通道不可用/控件未找到/模式不支持错误继续；歧义、遮挡、超时、断线或 `ACTION_OUTCOME_UNKNOWN` 均停止，不自动重复动作。结果记录 `backend`、`method`、`attempts` 和诊断产物。各通道不会自动推断不同页面/窗口是否属于同一应用，调用者需从观察结果明确绑定。

## 自研 Electron 配置

建议增加仅在显式调试模式启用的主进程配置，不需要改变渲染进程隔离策略：

```javascript
const { app, BrowserWindow } = require('electron');
const debugUi = process.env.WDB_UI_DEBUG === '1';
if (debugUi) {
  // 必须在 ready 之前配置 Chromium 启动参数。
  app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1');
  app.commandLine.appendSwitch('remote-debugging-port', '19222');
}
app.whenReady().then(() => {
  if (debugUi) app.setAccessibilitySupportEnabled(true);
  const win = new BrowserWindow({
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  // 保留应用原有 loadURL/loadFile 与 preload 配置。
});
```

也可直接通过 WDB `electron launch` 附加参数，不改代码。若应用禁用或忽略调试开关，需要由自研应用提供上述调试模式；不要给所有正式运行实例永久开启。调试端口仅用于本机，跨机器继续使用 WDB 的认证连接。

渲染层建议：

```html
<button data-testid="settings" aria-label="设置">设置</button>
<label for="class-name">班级名称</label>
<input id="class-name" data-testid="class-name">
```

使用标准 button/input/select 或实现完整 ARIA 角色、名称、状态和键盘操作。`data-testid` 用于稳定 CDP 定位；它不等于 UIA 的 AutomationId。自定义 Canvas/WebGL 需要额外语义控件或使用视觉坐标；加调试开关不会凭空生成画布内部控件。
