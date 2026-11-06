# macOS CLI 验收记录

2026-11-06，Asia/Shanghai。Mac 本地适配、共享客户端协议夹具和离线包验证通过。**跨机器认证与 Windows 业务闭环尚未完成**：用户正在 Windows 端调整首次配对的同意/拒绝/记住流程，本轮继续交付 Mac CLI，现有 `/v1/pair` 保持兼容。

## 环境与追溯

| 项目 | 实际值 |
|---|---|
| Mac | MacBook Pro / Apple M5 / arm64 / 24 GB |
| macOS | 26.7.2，build 25G332 |
| 运行时 | 官方 Node v24.15.0 darwin-arm64；开发机原有全局 Node v22.19.0，验收不使用它 |
| Node 归档 SHA-256 | `372331b969779ab5d15b949884fc6eaf88d5afe87bde8ba881d6400b9100ffc4`，与官方清单一致 |
| 产品 / 协议 | `0.1.0` / `/v1`、protocolVersion 1 |
| 源码 | 交接基线 `d889e65`；M1 `88fbceb`；客户端回归 `645696e`；最终包源码 SHA 和是否脏工作树以 `BUILD-INFO.json` 为准 |
| Mac / Windows 网络 | `172.20.115.38` → `172.20.115.75:18766`，en7 直连路由 |
| 预期 Windows 身份 | 交接文档记录 `qingwei / 2f493aacf427f3e9 / 0.1.0`；本轮未认证，尚未重新核对 |

## 已通过

| 检查 | 结果与边界 |
|---|---|
| 客户端回归 | 21 项通过、0 失败、0 跳过。使用本机临时生成测试证书，不复制 Windows 服务私钥 |
| 启动器 | 任意 cwd、中文/空格包路径、相对/绝对符号链接链及 PATH 入口；仅使用包内 Node；运行时缺失明确失败 |
| 配置 | `--config` > `WDB_CONFIG` > Mac 默认目录；仅新目录不存在时复制旧配置，保留旧文件；新目录即使为空也不合并；已有目录/文件权限修正为 0700/0600；配置符号链接拒绝 |
| 配对 / 身份夹具 | 错误指纹服务收到 0 请求；配对拒绝不落盘；成功配对不输出 token；断开后复用相同 token/clientId；多设备歧义、错误 deviceId、撤销及不兼容协议明确失败 |
| 任务 / 重连夹具 | 接受回包丢失时两次提交 body 完全相同、只执行一次；不支持去重时不重发；断开后的查询恢复并报告 SERVICE_RESTARTED/unknown，不重提任务 |
| 信号 | 子进程真实接收 SIGINT：普通 waiter 退出且未发 cancel，服务任务仍 running；显式 cancel 可取消；watch/follow 退出 0 并产生最终 interrupted JSON |
| 编码 / 参数文件 | 中文、多行、emoji JSON；本地 args/script/expression 文件；Windows path/cwd 和 PowerShell `$env` 内容保留 |
| 文件夹具 | 随机二进制与中文目录往返；hash 不符拒绝并清理；默认不覆盖；符号链接上传拒绝；显式下载覆盖替换链接本身，不修改其指向文件；本机大小写及 Unicode 归一化别名冲突明确失败 |
| 大长度边界 | 接收声明 `4294967313` 字节的响应后注入断流，进度长度未截为 32 位，原目标保留且 `.wdb-part` 清理；**不是完成了 4 GiB 传输** |
| 包完整性 | 5 项通过：移动至中文/空格目录、禁网且 PATH 无全局 Node 时启动；篡改、缺文件、多余文件、符号链接、清单越界/重复、执行位丢失均被拒绝 |
| 远端可达性 | 包内 Node TLS 探测成功，TLS 1.3 / TLS_AES_256_GCM_SHA384；未信任网络取得的证书，未发送 HTTP 请求、配对码或 token |

包内容采用明确清单，只带 3 个共享客户端源码文件、arm64 Node/许可证、Mac 启动器、校验/验收脚本、同一 Skill 与文档。没有 Windows 服务/桌面助手、FFmpeg、npm、凭据、截图或测试证书。

本机证据（Git 忽略）：

- `artifacts/macos/client-tests.log`：21 项客户端回归。
- `artifacts/macos/package-tests.log`：5 项离线包和负向校验。
- `artifacts/macos/remote-probe.json`：跨机器 TLS 探测，明确 `authenticated:false`、`trustedCertificate:false`、`httpRequestsSent:0`。
- `artifacts/macos/package-verification.json`：最终交付包文件校验、版本和运行时位置。
- `dist/wdb-client-macos-arm64/BUILD-INFO.json` 与 `SHA256SUMS.txt`：最终交付追溯和逐文件校验。

## 未通过完整验收的部分

以下是待验收范围，不列入通过项：

- 真实 PC 配对、同意/拒绝/记住交互，以及对应的临时授权/持久授权协议。现有服务按持久配对码立即返回 token；CLI 不虚构新的等待确认协议。
- Windows `info` 身份核对、真实中文目录传输、截图/MP4 拉取查看、UIA / Electron / Flutter 的观察→动作→状态闭环。
- 真实断网恢复、Windows 服务重启 unknown、远端授权撤销和多客户端竞争。对应的客户端恢复分支已有本地协议夹具覆盖。
- ≥1 GiB 不可压缩文件吞吐、完整 >4 GiB 文件往返、不同卷、真实大小写敏感卷及多屏。
- macOS 14 实机、另一台从未安装 Node/npm 的 Mac、带下载隔离属性的外部分发、签名/公证。本轮在 macOS 26.7.2 通过了禁网及隔离 PATH 启动，不等同于上述机器矩阵。
- Windows 全套回归。本轮最初尝试 `tests/device-id.test.js` 时两项因缺少专用 `.runtime/server/tls.pfx` 失败，未复制服务私钥补环境；最终 Mac 回归入口明确只运行客户端三个测试文件。

## 复现

```sh
./scripts/build-client-macos.sh
./dist/wdb-client-macos-arm64/runtime/node --test tests/cli.test.js tests/macos-client.test.js tests/client-portable.test.js
WDB_TEST_PACKAGE="$PWD/dist/wdb-client-macos-arm64" ./dist/wdb-client-macos-arm64/runtime/node --test tests/macos-package.test.js
./dist/wdb-client-macos-arm64/runtime/node ./dist/wdb-client-macos-arm64/scripts/verify-package.js
```

构建已存在的输出目录会拒绝覆盖。重新构建请先移开旧包或指定新路径。Windows 配对接口稳定且已有可信配对配置后，运行：

```sh
./dist/wdb-client-macos-arm64/runtime/node ./dist/wdb-client-macos-arm64/scripts/validate-lan.js \
  --device 172.20.115.75 --output ./artifacts/mac-lan-smoke
```

记录中的 TLS 可达性不替代这一步。真实截图应实际查看后再判断桌面验收，后续补测结果单独更新。
