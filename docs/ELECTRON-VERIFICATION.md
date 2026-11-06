# Electron 本机验证记录

日期：2026-11-06（Asia/Shanghai）。Windows 11 Pro x64，单屏3840×2160，已登录且解锁。本轮通过真实 `WdbService`（SYSTEM）和登录用户桌面助手执行，CLI 连接 `https://127.0.0.1:18766`；设备 `2f493aacf427f3e9`。未声明 LAN、macOS 或其他 Electron 版本通过。

## 应用与范围

使用用户指定的桌面安装包 `EasiClassSetup_1.0.13.698.exe` 恢复安装。安装登记版本1.0.13.698，EXE文件版本1.0.13.659，“关于”显示1.0.13；实际渲染器报告 Electron32.2.1 / Chromium128.0.6613.186。安装路径为 `%LOCALAPPDATA%\Programs\EasiClass\EasiClass.exe`。未修改应用源码，通过 `electron launch --port 19222` 开启本机调试及辅助功能。

早期三类应用报告测试的是1.0.14.659。本轮旧包菜单不同，真实业务冒烟采用“更多操作 → 关于 → 关闭”，不将两个版本的结果混为一谈。启动时用已观察的“稍后更新”关闭升级提示，没有安装更新。

## 三通道结果

| 路径 | 实际操作与观察 | 结果 / 证据 |
|---|---|---|
| CDP | 发现业务页面，按精确名称打开“更多操作”，按 `.icon-ic-about` 打开“关于”，等待对话框可见，读取1.0.13并截图 | 通过；`artifacts/electron-validation/cdp-more-fixed.json`、`cdp-open-about.json`、`cdp-wait-about.json`、`cdp-about-screenshot-0.png` |
| UIA | 重新查找“更多操作”，携带完整reference执行Invoke；用CDP读取该按钮 `aria-expanded=true` 确认菜单已打开 | 通过；`uia-find-optimized.json`、`uia-invoke-optimized.json`、`uia-optimized-observed.json`。查找约7.99秒，动作任务约10.18秒，仍明显慢于本轮CDP操作 |
| 视觉 / Windows输入 | 查看最新可见桌面截图，在“关于”关闭按钮的物理坐标发送真实鼠标点击，再用CDP等待对话框隐藏 | 通过；`visual-before-close-0.png`、`visual-close-about.json`、`visual-close-confirmed.json`。首次前台激活被Windows拒绝；独立桌面控制激活后重新截图，再执行WDB点击成功 |
| 联合观察 | 最终版本单次 `electron observe` 返回CDP、UIA、视觉三个结果和产物 | 三通道均 `ok:true`，约3.04秒；`final-combined-observation.json` |

上表除完整路径外的文件均在 `artifacts/electron-validation/`。本轮是分别指定通道的真实验证；自动兜底分支另由路由测试覆盖，未将三个独立动作描述为一次自动切换。视觉识别和坐标选择由Agent完成，WDB负责布局/焦点/落点校验及输入。

## 定位并修复的问题

1. **UIA引用回查慢，且旧路径可能在超时后才点击。** 本轮增加逐阶段诊断后，实测一次全子树RuntimeId查找耗时约18.36秒，Invoke本身约31毫秒。15秒任务期限已过，旧代码仍继续Invoke。改为独立MTA线程处理UIA、新reference附带名称/AutomationId/类型查询提示且继续核对RuntimeId，并在查询返回、取得Pattern和实际动作前检查取消。修复后的Invoke已由应用菜单状态确认成功。这说明本轮按钮的主要耗时在引用回查，不能据此断言旧版本“背景设置”超时具有完全相同根因。
2. **取消后禁止延迟动作。** 故意去掉reference的查询提示复现慢路径，设置15秒期限；修复后返回 `ACTION_OUTCOME_UNKNOWN`，诊断只有查找开始，没有Invoke记录，操作前后菜单均关闭。任务返回耗时约20.17秒，包括最多5秒原生进程清理宽限。证据：`cancel-before-dispatch-fixed.json`、`cancel-before-dispatch-fixed-0.jsonl`、`cancel-before.json`、`cancel-after.json`。不确定错误仍要求重新观察，不允许自动换通道重复点击。
3. **输入清空失败。** 首轮实际渲染器测试发现Ctrl+A/Backspace方式未清空目标输入。改为仅选择目标字段内容，再通过CDP `Input.insertText`替换（包括空字符串），避免依赖应用全局快捷键。直接替换探测和最终完整CLI测试均通过；首轮失败报告保留于 `artifacts/electron-renderer-validation/report.json`。

这些修复分别提交，未覆盖原始失败记录。

## 真实渲染器机制测试

`scripts/validate-electron.js` 通过完整WDB CLI链路在EasiClass页面创建独立临时面板，用于验证应用业务界面没有覆盖的输入和错误分支；最后移除精确标记的面板。这不是EasiClass业务表单验收。

2026-11-06 11:00:38至11:00:50：开放Shadow DOM定位、中文fill、追加type、点击、状态等待、重复匹配拒绝、禁用控件拒绝、清空、console事件、3840×2160截图及产物拉取均通过。实际结果为 `中文 WDB 123 ✓`，点击计数1，输入与点击事件的 `isTrusted=true`；清空后值为空，最终 `cleanup:true`。CDP事件的isTrusted不等于Windows实体输入验证。

报告：[本机JSON证据](../artifacts/electron-renderer-validation-fixed/report.json)。机制测试预期包含两次失败任务（`AMBIGUOUS_CONTROL`、`CONTROL_DISABLED`），两者均是拒绝不明确或不可用操作的成功断言。

## 回归与交付

- 标准 `npm test`：46项，45通过、0失败、1项真实服务测试默认跳过；`artifacts/electron-full-final.log`。
- 独立启用真实服务CLI测试：1通过、0失败；`artifacts/electron-cli-live-final.log`。
- 原生桌面回归含取消后不Invoke：1通过；`artifacts/electron-uia-fix-regression.log`。
- Agent Skill格式校验通过。指南与复验命令见 [Electron调试文档](ELECTRON.md)。

证据PNG、console和任务JSON留在本机被Git忽略的 `artifacts/`，避免提交用户界面及应用日志；源代码、可复用验证脚本和此报告纳入Git。console是限定时间内的采集，不是应用全部历史日志。

当前边界：UIA在此应用仍有秒级延迟；Canvas内部语义、iframe内部及closed Shadow DOM不自动展开；视觉输入要求目标前台且落点正确；没有验证账号登录、课程发布等完整业务流程。此次没有把CDP成功算作触摸或其他应用适配通过。
