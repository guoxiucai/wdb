# Windows localhost CLI 自验证

此验证将命令执行与独立证据配对：文件比较实际字节，部署核对 HKCU 与 marker，输入核对测试程序事件，录像全量解码，转发在收到 FIN 后才回复。只检查命令退出码不算功能验收。

## 准备与执行

需要 Windows、Node 22+、已安装并健康的 WDB 服务及普通用户桌面 helper、.NET Framework 编译器、FFmpeg。桌面保持登录且解锁，运行期间不要操作测试窗口。使用专用、已经人工同意并记住的客户端配置；不要与其他交互 shell/转发任务共用测试身份。脚本不会创建或代点连接同意窗口。

该配置应只含一个已启用的 loopback 设备（127.0.0.1、localhost 或 ::1）。输出目录必须不存在，避免覆盖上轮证据。

```powershell
npm test
node scripts/validate-cli-localhost.js --config <专用配置目录> --output artifacts/cli-localhost-run-01
```

默认用 `C:\Program Files\wdb\runtime\ffmpeg.exe` 解码，可用 `--ffmpeg <绝对路径>` 指定。失败项逐项记录在 `report.json`，不影响无依赖项目继续执行；任何 fail/blocked 或清理失败都会令最终退出码为 1。报告记录源码 SHA、命令、任务 ID、验证结果和错误，不记录凭据。

## 真实 CLI 用例

| ID | 验证内容 | 独立判断依据 |
| --- | --- | --- |
| C01–C05 | 帮助/版本、connect/info、devices/watch、disconnect、clients list | JSON/NDJSON、断开隐藏、凭据保留、免审批重连、本机/远端管理参数边界 |
| C06–C10 | shell 普通用户/SYSTEM、Unicode/环境/cwd/脚本文件、失败退出、任务全部管理动作 | 用户身份、输出内容、退出码、任务状态、等待超时及取消 |
| C11–C12 | 文件/目录传输、显式覆盖、缺失路径 | 随机字节往返、hash、错误码与半成品不存在 |
| C13–C15 | 文件/事件日志、订阅、桌面/显示器 | 独立追加日志、实际事件数据、坐标布局元数据 |
| F01–F02 | forward/reverse CLI 入口及生命周期 | NDJSON ready/closed、随机字节、FIN 后回复、中断后端口重绑 |
| D01–D04b | 自建应用启动、窗口状态、UIA、键盘/文本/鼠标全动作 | 窗口实时状态、控件值/Toggle、应用日志中的点击/双击/拖拽/滚轮事件 |
| D05–D06 | 窗口/区域截图、布局过期、触摸 | PNG 尺寸/映射、错误码、实际 touch down/up 事件 |
| D07–D09 | 有界录屏/停止、关闭窗口/失效引用 | H264 与完整 decode EOF、录屏任务终态、STALE_WINDOW |
| A01–A05 | list/install/update/uninstall、权限参数冲突 | 仅自建 HKCU 部署夹具，注册表版本、marker 与卸载后条目消失 |
| Z01 | 清理 | 取消仍运行的自有任务、删除自有注册表/临时目录、结束自有窗口；不停止服务 |

共 34 个真实用例。部署夹具不安装业务软件、不注册服务；桌面夹具的输入坐标必须由本次观察取得，并在注入前核对目标窗口。已完成任务及其服务端产物依既有保留策略留存，供 taskId 排查，不清理他人任务。

## 补充验收

```powershell
# 真实 ConPTY 中运行 CLI，核对 Unicode、编辑键、Ctrl+C、resize、退出后提示符
node scripts/validate-stream-tty-windows.js --cli src/cli.js --config <配置目录> --device 127.0.0.1:18766 --output artifacts/tty-run-01
# 并发转发/半关闭与交互 shell；默认不做长压测
node scripts/validate-streams-windows.js --cli src/cli.js --config <配置目录> --device 127.0.0.1:18766 --output artifacts/streams-run-01
# SSE 增量输出、断流恢复、取消、单 JSON 输出；默认不重启服务
node scripts/validate-sse-windows.js --cli src/cli.js --config <配置目录> --device 127.0.0.1:18766 --output artifacts/sse-run-01
node --test tests/desktop.test.mjs
node --test tests/desktop-dpi.test.mjs
```

Electron/Flutter 的协议、路由和异常由默认测试覆盖；真实应用需独立诊断实例与观察到的 endpoint/target/isolate，参考 `validate-electron.js`、`validate-flutter.js` 及对应应用指南。没有实例或地址应记为 not-run，不能用模拟协议通过替代实际应用验收。

授权拒绝/超时/撤销及隔离使用独立服务夹具验证，不撤销真实测试主身份。首次真实授权弹窗需要操作者本人同意。当前 DPI 通过不能代替其他真实显示比例；本机 loopback 通过不能代替跨主机 LAN、Mac、Windows 10、多显卡、物理触摸或长时间稳定性测试。

## BUG 与证据

本机运行报告、BUG 清单和隐私截图放在忽略的 `dev_doc/` 或 `artifacts/`。每个缺陷记录复现输入、预期/实际、首次失败证据、影响与原因、修复 SHA 和复测入口；测试脚本缺陷、环境限制与产品缺陷分开统计。修正用例后保留首次失败报告，使用新输出目录复测。
