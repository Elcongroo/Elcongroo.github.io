---
title: "strongSwan 源码导览"
description: "整理固定源码基线、核心目录、函数入口与证据口径。"
date: "2026-09-29"
updated: "2026-09-29"
category: "vpn"
modules: ["ipsec"]
editorial: "original"
tags: ["strongSwan", "IKEv2", "strongSwan 架构与方法"]
kind: "源码精读"
minutes: 15
featured: false
series: "strongSwan 架构与方法"
seriesOrder: 5
difficulty: "进阶"
prerequisites: ["按正文的概念解释、源码入口与关联文章补齐前置知识"]
environment: ["原稿整理；本次发布未新增运行实验"]
software: ["strongSwan 6.0.3；源码快照与本地适配边界见正文"]
conclusion: "source"
realVerified: false
verificationActor: "保留原稿的源码分析、资料判断与实验边界；未将文档迁移视为新增实测"
provenance: {"title": "strongSwan 源码导览", "mode": "原稿收录", "omissions": []}
changes: [{"date": "2026-09-29", "note": "收录技术原稿；调整标题层级、网页图示与站内链接。"}]
repository: "https://github.com/strongswan/strongswan/tree/472dcd8bb50a91f156b725ff56992352b573f7dd"
basis: {"label": "strongSwan 6.0.3 源码", "href": "https://github.com/strongswan/strongswan/tree/472dcd8bb50a91f156b725ff56992352b573f7dd", "boundary": "上游分析、本地适配与实验记录的区别以原文标注为准。"}
---

## 1. 文档目的

本文是 strongSwan 6.0.3 **上游源码**的结构化索引，用九个问题组织，回答：若对照 GM/T 0022—2023 做国密 IPsec，标准语义与上游实现的差距会落在哪些扩展点。它不描述某一份已经国密化的产品代码。

本文**不另起炉灶**，内容全部由以下文档回填（每条标注「证据来源」指向来源文档，行号以来源文档为准）：

- 《strongSwan 设计者视角：对象模型、扩展机制与目录职责》（先解释配置对象、运行时SA、task、manager、插件和目录为什么存在）
- 《strongSwan 6.0.3 总体框架与关键调用流程》（进程架构、目录职责、IKEv1/IKEv2 控制面、密码抽象、XFRM 数据面）
- 《strongSwan 全链路数据流与模块协作图解》（从配置、IKE 报文、密钥到 XFRM/ESP 的可视化主链）
- 《strongSwan 从系统到函数：Task Manager 分层定位图》（从网关、charon、IKE_SA、manager、task逐层建立空间坐标）
- 《strongSwan IKEv2/IKEv1 Task Manager 源码精读》（分别解释两个版本怎样推进exchange、MID、重传与具体task）
- 《strongSwan 源码学习方法与实战路线》（把主链转化为逐次可执行、可验证的源码学习流程）
- 《strongSwan 五链源码精读 01—05》（逐函数说明每条主链的输入、对象变化、输出、失败路径与验证方法）
- 《GM/T 0022—2023 与 strongSwan 6.0.3 上游差距分析》（1.1 协议画像、双证书、数字信封、keymat 与 Quick Mode 差距）
- 《strongSwan 上游源码研究与国密改造点定位》（proposal/Transform/keymat/XFRM 改造点与源码锚点）
- 《strongSwan Proposal 到 XFRM 源码精读附录》（算法 ID 定义、线上映射、crypto factory、keymat、XFRM 名称映射的深入）

需要深入某个函数或调用关系时，回到上述文档；本文只回答「在哪一层」。

## 2. 研究基线

| 项 | 内容 |
| --- | --- |
| 版本号 | strongSwan 6.0.3（官方发布提交 `472dcd8`） |
| 源码主目录 | `src/libstrongswan/`、`src/libcharon/`、`src/swanctl/` |
| 数据面路线 | Linux XFRM（`kernel-netlink` 插件）；另有 `src/libipsec/` 用户态 ESP 路线（非默认） |

## 3. 证据规则

本文遵循《GM-VPN 技术文档写作规范》第 12 章的六类标注。本文所有条目均为「从第 1 章所列文档回填的索引」，证据来源列写 `来源文档 + 章节号`，不在此重复贴行号，也不在此新增未在来源文档中出现的事实。

## 4. 源码导览骨架

### 4.1 入口在哪里

| 项 | 内容 | 证据来源 |
| --- | --- | --- |
| 守护进程入口 | `charon`，框架组装在 `src/libcharon/daemon.c`（依赖注入总装配点） | 总体框架 §6 |
| 配置入口 | `swanctl`（`src/swanctl/commands/load_conns.c` 的 `load_conn()`） | 总体框架 §8 |
| 配置进入 charon | VICI `load-conn` → `src/libcharon/plugins/vici/vici_config.c` | 总体框架 §9 |
| 发起连接触发点 | `vici_control.c` → `controller.c` → `ike_sa->initiate()` | 总体框架 §10 |

### 4.2 IKE 控制面模块路径

| 顺序 | 模块 | 职责 | 证据来源 |
| --- | --- | --- | --- |
| 1 | `swanctl` / VICI | 配置与控制请求入口 | 总体框架 §8、§9 |
| 2 | `vici_config.c` | 配置字符串 → `ike_cfg` / `peer_cfg` / `child_cfg` | 总体框架 §9 |
| 3 | `controller.c` | 外部控制请求 → IKE_SA 运行对象 | 总体框架 §10 |
| 4 | `ike_sa.c` | IKE 安全关联总运行对象 | 总体框架 §11 |
| 5 | `task_manager.c` | 按版本分叉 `task_manager_v1` / `task_manager_v2` | 总体框架 §12 |
| 6 | `encoding/`（`message.c` + `payloads/`） | IKE 报文生成/解析、Proposal/Transform 编解码 | 总体框架 §14 |
| 7 | `crypto_factory.c` + plugins | 算法对象构造 | 总体框架 §4.3 |
| 8 | `keymat_v1.c` / `keymat_v2.c` | IKE / CHILD 密钥派生 | 总体框架 §19 |
| 9 | `child_sa.c` | 协商结果 → IPsec SA（SPI/key/TS） | 总体框架 §20 |
| 10 | `kernel_netlink/` | 用户态 → Linux XFRM 下发 | 总体框架 §22 |

### 4.3 核心结构体

| 结构体 | 所在文件 | 承载的状态或数据 | 证据来源 |
| --- | --- | --- | --- |
| `ike_cfg` | `config/` | IKE 层配置（地址、IKE proposal、版本） | 总体框架 §9、上游研究 §3.1 |
| `peer_cfg` | `config/` | peer 连接总体策略（认证、IKE、child） | 总体框架 §9、上游研究 §3.2 |
| `child_cfg` | `config/` | CHILD_SA / ESP 层配置（proposal、TS、mode） | 总体框架 §9、上游研究 §3.3 |
| `proposal_t` | `crypto/proposal/` | Transform Type + Algorithm ID + Key Size | 上游研究 §3.4 |
| `ike_sa_t` | `sa/ike_sa.c` | IKE SA 状态、SPI、keymat、task_manager、CHILD 列表 | 总体框架 §11、上游研究 §3.5 |
| `task_manager_t` | `sa/task_manager.c` | IKEv1 / IKEv2 任务驱动 | 上游研究 §3.6 |
| `keymat_t`（v1/v2） | `sa/ikev1/keymat_v1.c` / `sa/ikev2/keymat_v2.c` | 密钥派生（不决定算法字符串、不逐包加密） | 上游研究 §3.7 |
| `child_sa_t` | `sa/child_sa.c` | CHILD_SA 方向、SPI、算法、密钥 | 上游研究 §3.8 |

### 4.4 关键函数

| 函数 | 所在文件 | 职责 | 证据来源 |
| --- | --- | --- | --- |
| `load_conn()` | `swanctl/commands/load_conns.c` | 构造 VICI load-conn 请求 | 上游研究 §4.1 |
| `parse_proposal()` | `vici/vici_config.c` | 配置字符串 → proposal | 上游研究 §4.2 |
| `initiate()` / `initiate_execute()` | `vici_control.c` / `controller.c` | 发起连接 | 上游研究 §4.3 |
| `task_manager_create()` | `sa/task_manager.c` | 按版本创建 task manager | 上游研究 §4.4 |
| `add_string_algo()` / `check_proposal()` | `crypto/proposal/proposal.c` | 配置 token → 算法；proposal 语义检查 | 上游研究 §5、§6 |
| `derive_ike_keys()` / `derive_child_keys()` | `keymat_v1.c` / `keymat_v2.c` | IKE / CHILD 密钥派生 | 上游研究 §10、§16 |
| `install_internal()` | `sa/child_sa.c` | 整理方向/SPI/算法/密钥给 kernel interface | 上游研究 §21 |
| `add_sa()` | `kernel_netlink/kernel_netlink_ipsec.c` | SA 下发内核 | 上游研究 §22 |

### 4.5 状态如何变化

| 阶段 | 进入条件 | 关键状态 | 证据来源 |
| --- | --- | --- | --- |
| 配置加载 | VICI load-conn | `ike_cfg` / `peer_cfg` / `child_cfg` | 总体框架 §9 |
| IKE_SA 建立 | `controller` → `ike_sa->initiate()` | `ike_sa_t`（状态机 + 配置 + keymat） | 总体框架 §10、§11 |
| 任务驱动 | task_manager 按版本分叉 | IKEv1 / IKEv2 task 队列 | 总体框架 §12 |
| 并发保护 | IKE_SA checkout / checkin | 同一时刻单线程操作同一 IKE_SA | 总体框架 §7 |
| CHILD_SA 安装 | child_create / quick_mode | `child_sa_t` → kernel interface | 总体框架 §20 |

### 4.6 密钥在哪里产生

| 阶段 | 发生位置 | 说明 | 证据来源 |
| --- | --- | --- | --- |
| 密钥交换 | `key_exchange_t`（crypto framework） | DH / ECDH / KEM 共享秘密 | 总体框架 §4.1 |
| IKE 密钥派生 | `keymat_v1.c` / `keymat_v2.c` | IKEv2：SKEYSEED → SK_d / SK_ai / SK_ar / SK_ei / SK_er / SK_pi / SK_pr | 总体框架 §19 |
| CHILD 密钥派生 | `keymat_v1.c` / `keymat_v2.c` 的 `derive_child_keys()` | ESP 方向密钥（encr / integ） | 上游研究 §10、§16 |
| 密钥安装 | `child_sa.c` → kernel interface | SPI / 算法 / 方向密钥 → XFRM | 上游研究 §21 |

### 4.7 密码算法注册与调用

| 用途 | 注册位置 | 调用位置 | 是否经过统一接口 | 证据来源 |
| --- | --- | --- | --- | --- |
| 对称加密 | `crypto/crypters/` | `crypto_factory.create_crypter()` | 是（`crypter_t`） | 总体框架 §4.1 |
| 摘要 | `crypto/hashers/` | `crypto_factory.create_hasher()` | 是（`hasher_t`） | 总体框架 §4.1 |
| PRF / KDF | `crypto/prfs/` | `crypto_factory.create_prf()` | 是（`prf_t`） | 总体框架 §4.1 |
| 完整性 / MAC | `crypto/signers/` | `crypto_factory.create_signer()` | 是（`signer_t`） | 总体框架 §4.1 |
| 密钥交换 | `crypto/key_exchange/` | `crypto_factory.create_ke()` | 是（`key_exchange_t`） | 总体框架 §4.1 |
| 算法标识映射 | `crypto/proposal/proposal_keywords*.txt` + `proposal.c` | 配置字符串 → internal Algorithm ID | 是 | 上游研究 §5.1 |
| 具体实现 | `plugins/openssl/`（EVP）、`plugins/pkcs11/` | plugin feature 注册 → factory 构造 | 是 | 总体框架 §4.4 |

### 4.8 数据面到内核的路径

| 环节 | 发生位置 | 数据形态 | 证据来源 |
| --- | --- | --- | --- |
| 提议下发 | IKE task（ike_init / quick_mode） | proposal / Transform | 总体框架 §16、§15 |
| 安全关联创建 | `child_sa.c` → kernel interface | SPI / 算法 / key / TS | 总体框架 §20 |
| 安全策略安装 | `kernel_netlink_ipsec.c` | XFRM SA / Policy（Netlink） | 总体框架 §22 |
| 报文加密封装 | Linux 内核 XFRM（非 strongSwan 用户态） | ESP encrypt / decrypt | 总体框架 §23 |

### 4.9 国密改造候选层

| 候选改造层 | 覆盖哪些能力 | 改动范围 | 证据来源 |
| --- | --- | --- | --- |
| 算法枚举 / 配置 | `crypter/hasher/prf/signer` 枚举 + `proposal_keywords` | 让 strongSwan 认识 SM3/SM4 | 上游研究 §27.1 |
| GM/T 协议画像 | `ike_header.h` + `task_manager_v1.c` | 区分普通 IKEv1 1.0 与 GM/T 1.1 | GM/T 差距分析 §4.1 |
| GM/T Main Mode 载荷 | `payload.h` + payload factory + `main_mode.c` | 类型 128、双证书、数字信封、M2-M6 状态 | GM/T 差距分析 §3、§4 |
| 协议 Transform 映射 | `encoding/payloads/proposal_substructure.c` | internal ID ↔ IKEv1/IKEv2 wire ID | 上游研究 §27.2 |
| 认证 / 证书 | credential / `private_key_t` / `public_key_t` / x509 | SM2 身份认证 | 上游研究 §27.3 |
| GM/T IKEv1 keymat | `keymat_v1.c` | 专用 SKEYID、IV、HASH_i/r 与 Quick Mode HASH 顺序 | GM/T 差距分析 §6、§7 |
| IKEv2 算法扩展 | `proposal_substructure.c` + `keymat_v2.c` | 保留 IKEv2 语义时扩展 SM/PQC；不等于 GM/T 0022 | IKEv2 源码精读 §12 |
| CHILD / XFRM | `child_sa.c` + `kernel_netlink_ipsec.c` | SM4/SM3 算法名、key length、truncation、方向密钥 | 上游研究 §27.5 |

## 5. 关联文档

| 文档 | 关系 |
| --- | --- |
| [strongSwan 6.0.3 总体框架与关键调用流程](strongSwan%206.0.3%20总体框架与关键调用流程.md) | 本文条目的事实来源（进程架构、调用链） |
| [strongSwan 全链路数据流与模块协作图解](strongSwan%20全链路数据流与模块协作图解.md) | 用九组图串起配置流、IKE 报文流、密钥流与 XFRM 数据流 |
| [strongSwan 源码学习方法与实战路线](strongSwan%20源码学习方法与实战路线.md) | 按五条主链完成定位、成功路径、失败分支、验证和小修改 |
| [五链 01：配置到 IKE_SA](strongSwan%20五链源码精读%2001%20配置到%20IKE_SA.md) | 配置文本、VICI、cfg后端与运行时IKE_SA |
| [五链 02：IKE报文到协议任务](strongSwan%20五链源码精读%2002%20IKE报文到协议任务.md) | socket、receiver、job、SA manager、task manager与具体任务 |
| [五链 03：Proposal与KE到密钥](strongSwan%20五链源码精读%2003%20Proposal与KE到密钥.md) | proposal选择、KE共享秘密、Nonce与IKE/CHILD密钥派生 |
| [五链 04：CHILD_SA到XFRM](strongSwan%20五链源码精读%2004%20CHILD_SA到XFRM.md) | 双向SA、policy和kernel-netlink下发 |
| [五链 05：业务IP包到ESP](strongSwan%20五链源码精读%2005%20业务IP包到ESP.md) | Linux XFRM逐包选路、ESP加解密、防重放与回注 |
| [GM/T 0022—2023 与 strongSwan 6.0.3 上游差距分析](GM-T%200022-2023%20与%20strongSwan%206.0.3%20上游差距分析.md) | 标准主模式、载荷、keymat、Quick Mode 与上游差距 |
| [strongSwan 上游源码研究与国密改造点定位](strongSwan%20上游源码研究与国密改造点定位.md) | 本文条目的事实来源（改造点、源码锚点） |
| [strongSwan Proposal 到 XFRM 源码精读附录](strongSwan%20Proposal%20到%20XFRM%20源码精读附录.md) | 算法 ID / 线上映射 / keymat / XFRM 的深入来源 |
| [国密改造映射矩阵](国密改造映射矩阵.md) | 本文「改造候选层」结论回填到映射矩阵 |

若五链内容仍显得像一串函数，先回到以下三篇建立“从大到小”的坐标，再把五链当作按问题查询的深入材料：

- [Task Manager分层定位图](strongSwan%20从系统到函数：Task%20Manager%20分层定位图.md)
- [IKEv2 Task Manager源码精读](strongSwan%20IKEv2%20Task%20Manager%20源码精读.md)
- [IKEv1 Task Manager源码精读](strongSwan%20IKEv1%20Task%20Manager%20源码精读.md)

## 参考资料

- 项目内部：[GM-VPN 技术文档写作规范](GM-VPN%20技术文档写作规范.md)、[国密改造映射矩阵](国密改造映射矩阵.md)、上文「关联文档」三篇

本文是索引，不含超出「关联文档」范围的新技术结论。
