# 鸿镜 Debug 验证闭环

2026-11-06（Asia/Shanghai），Windows localhost、单屏3840×2160，实际SYSTEM服务与登录用户助手。观察/操作通过WDB CLI执行，产物经CLI拉回；未修改鸿镜源码、未注入自造Widget作为业务界面。

## 实例

用户启动的Debug EXE位于 `D:\project\ohos-scrcpy-app\scrcpy_client_flutter\build\windows\x64\runner\Debug\scrcpy_client_flutter.exe`。初始PID31508，未连接设备，UIA29节点。因未获得调试地址，正常关闭后重启同一EXE并捕获stdout，得到回环VM URI；测试实例PID31960。完整认证路径只保存在Git忽略的本机证据中。

VM报告Dart3.11.5/windows_x64，依赖配置指向Flutter3.41.9，main isolate有32个Inspector扩展。正式CLI链路核对VM PID与窗口所属进程。测试结束保留该Debug实例，恢复窗口位置、尺寸及面板原状态。

## 实际结果

| 流程 | 操作及结果确认 | 结论 |
|---|---|---|
| 协议/联合观察 | info/observe读取399个应用Widget、UIA及截图；属性查询读到刷新按钮tooltip | 三通道成功，正常快照对象组释放 |
| UIA状态闭环 | 原窗口非最大化，位置15/15、1920×1200 → Invoke最大化 → windows.list确认true → 新查找的还原Invoke → 确认原位置尺寸恢复 | 通过 |
| 自动视觉兜底 | 应用安装面板原showSecond → 对真实控件auto点击 → UIA返回PATTERN_UNAVAILABLE → 按已观察坐标发送一次Windows点击 → Inspector wait确认showFirst，截图确认折叠 | 通过，实际两个attempt留证 |
| 视觉恢复 | 新截图定位 → 视觉点击面板标题 → Inspector wait确认showSecond → 截图确认恢复展开 | 通过 |
| 无VM降级 | 省略endpoint → Flutter通道明确不可用，UIA及截图继续成功 | 通过 |
| 诊断 | Widget属性/等待、错误PID拒绝、内存快照、限时事件采集；Inspector开关前后值相同 | 实机脚本通过 |

证据目录 `artifacts/flutter-validation/`：`cli-observe.json`、`uia-maximize.json`、`window-after-max.json`、`uia-restore.json`、`window-after-restore.json`、`card-before.json`、`auto-collapse-card.json`、`collapsed-confirmed.json`、`collapsed-screenshot-0.png`、`visual-restore-card.json`、`restored-confirmed.json`、`restored-screenshot-0.png`。未用超时错误触发重复点击。

UIA刷新按钮Invoke也成功，应用继续保持IDLE且可观察，但刷新后显示“找不到hdc命令”。因此只确认调用与错误展示，**设备发现、连接、投屏业务未在本轮通过**。未安装/卸载设备应用，也未向真实设备发送控制。

## 协议复验与边界

`scripts/validate-flutter.js` 报告 `artifacts/flutter-live-verified/report.json`：399个Widget、非空属性、正常对象组释放、等待成功、错误PID拒绝、有效内存数据、无VM降级及306条事件采集；确认本轮Inspector状态事件，passed=true。事件由读取后重新设置相同Inspector显示开关产生，不改业务状态。

首轮日志刺激尝试Dart evaluate返回RPC113，失败报告保留于 `artifacts/flutter-live-final/report.json`。最终脚本使用实际存在的Inspector扩展，不依赖表达式编译服务。WDB没有提供任意Dart求值接口。

初期树探测受框架深度/摘要范围影响；最终明确区分应用摘要与完整树，并识别本机引擎的valueId后成功读取属性。Widget存在不代表可见，本轮用crossFadeState与截图确认折叠。失败探测与通过证据分开保留。

自动化覆盖认证路径、RPC并发/取消/断线不重放、PID/isolate歧义、组清理、截断树拒绝证明不存在、作用域属性等待、联合观察降级及不确定动作禁止重放。最终标准回归和真实系统服务测试输出分别位于 `artifacts/flutter-full-final.log`、`artifacts/flutter-cli-live-final.log`。

最终标准测试59项：58通过、0失败、1项真实服务测试默认跳过；真实服务测试另行启用后1通过、0失败。Agent Skill格式校验通过。闭环任务索引另存 `artifacts/flutter-validation/closed-loop-report.json`。

未运行实际Profile/Release构建或第二台机器：缺失Inspector分支由协议夹具覆盖，无VM联合观察由真实鸿镜覆盖，不称为完整兼容矩阵。内存快照不算CPU/帧性能验证。任务JSON、截图和日志只在本机artifacts保留，源码、可复用脚本与本报告提交Git。
