# Flutter UI 调试

链路为 `CLI → 已配对HTTPS服务 → 登录用户桌面助手 → 应用`。WDB直接连接Dart VM Service和Inspector扩展读取Widget、属性与事件；UIA及Windows输入执行动作，截图供Agent识别。桌面需要登录且解锁。

## 接入

自研项目运行 `flutter run -d windows --debug`，使用输出中的 **Dart VM Service URI**，保留完整认证路径；不是DevTools网页URL。WDB不扫描端口，不关闭认证，只接受服务端本机回环HTTP/WS地址。

从 `wdb windows list --json` 获取窗口ID，将以下字段保存为本地 `flutter-session.json` 并替换占位符：

```json
{
  "endpoint": "http://127.0.0.1:58351/<启动日志中的认证路径>/",
  "window": "<windows list返回的完整窗口ID>"
}
```

```powershell
wdb flutter info --args-file flutter-session.json --json
wdb flutter observe --args-file flutter-session.json --json
wdb flutter tree --args-file flutter-session.json --json
```

info返回VM进程、版本、isolate、扩展及能力，隐藏认证路径。提供window时核对VM PID与窗口进程，也可显式给pid。多个Flutter isolate时，将info返回的isolate ID加入会话JSON或用 `--isolate` 指定。应用重启后重新获取URI、窗口和isolate。会话文件含调试凭据，不应提交Git或分享。

Release应用可以只提供window，使用observe/action/screenshot；Flutter通道明确标记不可用，UIA与截图继续。

## 命令与选择器

| 命令 | 行为 |
|---|---|
| info / isolates | VM、isolate及能力发现；不凭端点不可达推断Release |
| tree | 默认应用Widget摘要；`--tree-mode full` 获取含框架节点的树，需要引擎支持 |
| find | 按Widget类型、描述或源码创建位置筛选 |
| properties | 重新定位唯一Widget，读取诊断属性 |
| wait | 等待present/absent，或唯一Widget属性匹配 |
| logs | 限时监听Stdout、Stderr、Logging、Extension事件并保存JSON |
| memory | 当前isolate的堆使用、容量和外部内存 |
| observe | Flutter树、UIA树、Windows截图分别返回ok/error |
| screenshot | Windows截图及物理坐标映射 |
| action | UIA操作或显式视觉输入；Inspector不作为业务点击驱动 |

选择器支持 `--widget-type`、`--description`（精确）、`--contains`（描述包含）、`--source-file`（tree返回的完整URI）和 `--line`；组合取交集。Widget描述经常只有类型名，不等同于UIA名称；文字、tooltip、状态等通过properties读取。

```powershell
wdb flutter find --args-file flutter-session.json --widget-type IconButton --json
# 将下面的源码URI、行号替换为实际观察结果
wdb flutter properties --args-file flutter-session.json --widget-type IconButton --source-file 'file:///C:/MyApp/lib/top_bar.dart' --line 197 --json
wdb flutter logs --args-file flutter-session.json --durationMs 2000 --json
wdb flutter memory --args-file flutter-session.json --json
```

同一源码位置多次创建Widget时，可在参数JSON中指定唯一ancestor，再查询其后代。本轮鸿镜的实际折叠状态选择器如下；其他构建需要重新观察：

```json
{
  "widgetType": "AnimatedCrossFade",
  "ancestor": {
    "widgetType": "_Card",
    "sourceFile": "file:///D:/project/ohos-scrcpy-app/scrcpy_client_flutter/lib/ui/sidebar.dart",
    "line": 27
  },
  "property": "crossFadeState",
  "value": "showFirst",
  "state": "present",
  "timeoutMs": 5000
}
```

将这些字段合入含endpoint/window/isolate的参数文件，再执行 `wdb flutter wait --args-file <文件> --json`。匹配使用Inspector属性的description字符串，不是Dart求值。歧义明确报错，不能取第一个替代定位。

默认深度400、1000节点，上限1000层/10000节点，单条协议JSON上限16MiB。truncated=true时不据此证明控件不存在或定位唯一。摘要只覆盖应用Widget；Widget存在不代表屏幕可见，折叠面板可能仍保留Widget，需检查属性、UIA或截图。

每次快照创建自己的Inspector对象组，正常结束释放；失败/取消尽力释放并报告cleanup。失联可能导致清理失败，需应用重启清理，WDB不清除其他调试器的对象组。返回path只描述本次树，不作为跨命令引用；属性输出去除临时对象句柄。

日志默认1秒/200条，最长60秒、最多2000条及约1MiB事件原文。无事件不算失败；日志不是全量历史记录，可能含业务信息。没有isolate标识的Stdout/Stderr按同一VM范围收集。memory不是CPU/帧率测量；本轮未实现源码断点、热重载、CPU时间线或任意Dart执行。

## UIA与视觉闭环

```powershell
wdb ui find --window '<窗口ID>' --name '刷新设备列表' --json
wdb flutter action --args-file flutter-session.json --backend uia --name '刷新设备列表' --action click --json
```

推荐传递新查询返回的完整reference。click映射Invoke，fill映射ValuePattern，其他动作沿用原有UIA能力。操作后用wait、properties、UIA状态或截图确认结果。

action默认auto先走UIA，仅对明确未执行的控件缺失、引用过期、Pattern不支持，在提供 `visual:{x,y,layoutId}` 时切换视觉点击。歧义、超时、失联或ACTION_OUTCOME_UNKNOWN均停止，不自动重放。视觉坐标必须来自最新截图的物理桌面像素，WDB检查布局、前台和落点窗口。

## 自研配置

- Debug通常提供VM Service和Inspector，保留默认Widget创建位置跟踪；不需要WDB SDK。
- Profile可保留VM/性能诊断，标准Widget Inspector通常缺失。WDB按实际扩展探测能力。
- 标准Release没有VM/Inspector，使用UIA和视觉；给EXE加端口参数不能恢复已移除的调试能力。
- UIA依赖Semantics。标准控件通常有语义，自绘控件应补名称、角色、状态与动作。支持的Flutter版本可用Semantics(identifier: ...)提供稳定标识；普通Key不等于AutomationId。
- 若没有收集语义，可在显式测试模式调用SemanticsBinding.instance.ensureSemantics()，保留handle并在结束时dispose；启用收集不会自动生成自绘画布内部语义。
- 单独启动Debug EXE可开放Inspector，表达式编译等功能仍可能需要开发工具服务，不能把连接VM等同于拥有完整DevTools能力。
