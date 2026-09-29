---
title: "OpenVPN 源码导览"
description: "以版本、模块和源码锚点建立 OpenVPN 阅读入口。"
date: "2026-09-29"
updated: "2026-09-29"
category: "vpn"
modules: ["tls"]
editorial: "original"
tags: ["OpenVPN", "TLS", "OpenVPN 架构与方法"]
kind: "源码精读"
minutes: 15
featured: false
series: "OpenVPN 架构与方法"
seriesOrder: 4
difficulty: "进阶"
prerequisites: ["按正文的概念解释、源码入口与关联文章补齐前置知识"]
environment: ["原稿整理；本次发布未新增运行实验"]
software: ["OpenVPN 2.7.4；涉及 Tongsuo 时按正文指定版本"]
conclusion: "source"
realVerified: false
verificationActor: "保留原稿的源码分析、资料判断与实验边界；未将文档迁移视为新增实测"
provenance: {"title": "OpenVPN 源码导览", "mode": "原稿收录", "omissions": []}
changes: [{"date": "2026-09-29", "note": "收录技术原稿；调整标题层级、网页图示与站内链接。"}]
repository: "https://github.com/OpenVPN/openvpn/tree/v2.7.4"
basis: {"label": "OpenVPN 2.7.4 源码", "href": "https://github.com/OpenVPN/openvpn/tree/v2.7.4", "boundary": "上游分析、本地适配与实验记录的区别以原文标注为准。"}
---

## 1. 文档目的

本文是 OpenVPN 2.7.4 源码工程手册的**阅读入口和结构化索引**。它先帮助读者从系统、进程、对象和数据流建立全景，再沿六条端到端调用链进入函数，最后定位 TLS/TLCP、数据通道国密和 DCO 的改造边界。

工程手册的事实依据来自固定版本上游源码。各文档分工如下：

- 《OpenVPN 2.7.4 总体框架与关键调用流程》（运行框架、目录职责、对象与调用链）
- 《OpenVPN 设计者视角：进程模型、双通道架构与目录职责》（设计问题、完整文件地图与阅读优先级）
- 《OpenVPN 全链路数据流与模块协作图解》（用多级流程图串起进程、控制通道、数据通道和 DCO）
- 《OpenVPN 从系统到函数：TLS、Key State 与双通道分层定位图》（回答一个函数、结构体在系统中的位置）
- 六篇《OpenVPN 六链源码精读》（逐链说明输入、结构体、函数、输出、失败和下一消费者）
- 《OpenVPN TLS控制通道与Key State生命周期源码精读》（解释状态、重协商与新旧密钥过渡）
- 《OpenVPN 数据通道包格式、密钥轮换与DCO源码精读附录》（解释 P_DATA、加解密格式、Key ID 与内核卸载）
- 《OpenVPN 上游源码研究与国密改造点定位》（TLS/TLCP 改造点与源码锚点）
- 《OpenVPN Tongsuo 双证书与密钥生命周期附录》（双证书与密钥生命周期深入）
- 《OpenVPN 源码阅读实战方法：从配置与事件循环到双通道数据流》（学习与培训材料，训练如何独立读代码）

需要深入某个函数或调用关系时，回到对应专题；本文负责回答“先读什么、它在哪一层、下一步去哪”。

### 1.1 推荐阅读顺序

不要按文件名字母顺序阅读。根据当前问题选择路线：

| 阶段 | 先回答的问题 | 推荐文档 | 完成标志 |
| --- | --- | --- | --- |
| 1. 系统全景 | OpenVPN进程整体怎样工作 | 设计者视角 → 全链路图解 | 能画出配置、事件循环、控制通道、数据通道和DCO关系 |
| 2. 对象定位 | `context`、`tls_multi`、`key_state`放在哪 | 从系统到函数分层定位图 | 能说明对象的生命周期与上下游 |
| 3. 端到端链路 | 一个输入怎样逐步变成输出 | 六链01至06 | 能沿源码说出关键函数、结构体和下一消费者 |
| 4. 专题加深 | 状态、换钥和数据包究竟怎样工作 | Key State生命周期 → 数据通道附录 | 能解释重协商、Key ID、AEAD/CBC和DCO边界 |
| 5. 国密研究 | 哪些是上游能力，哪些需要改造 | 上游改造点 → Tongsuo双证书附录 | 能区分TLS/TLCP控制面与SM4数据面 |
| 6. 独立训练 | 怎样自己读陌生OpenVPN代码 | 学习与培训中的源码阅读实战方法 | 能独立定位一条新调用链并验证 |

第一次阅读建议只完成阶段 1 和 2；第二遍选择一条链手工跟读；遇到具体问题再查专题。这样既不被细节淹没，也不会永远停留在架构图。

## 2. 研究基线

| 项 | 内容 |
| --- | --- |
| 版本号 | OpenVPN 2.7.4（官方发布 `v2.7.4`，对应提交 `8e9e91f`） |
| 源码主目录 | `src/openvpn/` |
| 密码后端 | OpenSSL（`ssl_openssl.c` / `crypto_openssl.c`）；另有 mbedTLS 后端（`ssl_mbedtls.c` / `crypto_mbedtls.c`）用于对照后端隔离 |

## 3. 证据规则

本文遵循《GM-VPN 技术文档写作规范》第 12 章的六类标注。本文所有条目均为「从第 1 章所列文档回填的索引」，证据来源列写 `来源文档 + 章节号`，不在此重复贴行号，也不在此新增未在来源文档中出现的事实。

## 4. 源码导览骨架

### 4.1 入口在哪里

| 项 | 内容 | 证据来源 |
| --- | --- | --- |
| 进程入口 | `openvpn_main()`（`src/openvpn/openvpn.c`），init-run-cleanup 主循环 | 总体框架 §5.1 |
| 模式分叉 | 客户端 `tunnel_point_to_point()`；服务端 `tunnel_server()` | 总体框架 §5.1 |
| tunnel 初始化 | `init_instance()`（`src/openvpn/init.c`）→ `do_init_crypto()` → `do_init_crypto_tls()` | 总体框架 §5.2 |
| 控制通道启动触发点 | `do_init_crypto_tls()` 内 `tls_multi_init()` / `tls_multi_init_finalize()` | 总体框架 §10.2 |

### 4.2 经过哪些模块

| 顺序 | 模块 | 职责 | 证据来源 |
| --- | --- | --- | --- |
| 1 | `options*.c` | 命令行/配置解析 → `struct options` | 总体框架 §3.1-A |
| 2 | `init.c` | 静态配置 → 运行对象（socket / TUN / TLS / crypto） | 总体框架 §3.1-A |
| 3 | `forward.c` | 主循环报文转发分叉（`process_io()`） | 总体框架 §3.1-B |
| 4 | `ssl.c` | 控制通道状态、TLS session、数据通道 key state | 总体框架 §3.1-C |
| 5 | `ssl_openssl.c` | OpenSSL 后端：`SSL_CTX` / `SSL` / BIO / Exporter | 总体框架 §3.1-C |
| 6 | `crypto.c` | 数据通道 packet 加解密通用逻辑 | 总体框架 §3.1-D |
| 7 | `ssl_ncp.c` | 数据通道 cipher 协商（NCP / `data-ciphers`） | 总体框架 §3.1-D |
| 8 | `multi.c` | 服务端多客户端框架 | 总体框架 §3.1-E |
| 9 | `dco*.c` | 数据通道下沉内核（DCO） | 总体框架 §3.1-F |

### 4.3 核心结构体

| 结构体 | 所在文件 | 承载的状态或数据 | 证据来源 |
| --- | --- | --- | --- |
| `struct options` | `options.h` | 静态配置（用户想要什么） | 总体框架 §4.1 |
| `struct context` | `openvpn.h` | 主运行对象：`options` + `c1` + `c2` | 总体框架 §4.2 |
| `tls_root_ctx` | `ssl.h` | TLS library context 的包装（内持 `SSL_CTX *`） | 总体框架 §4.3 |
| `tls_multi` | `ssl.h` | 一个 tunnel 的 TLS / 数据密钥总体状态 | 总体框架 §4.4 |
| `tls_session` | `ssl.h` | TLS session / negotiation 生命周期 | 总体框架 §4.4 |
| `key_state` | `ssl.h` | 某一代 key state（`key_state_ssl` + data channel crypto） | 总体框架 §4.4 |
| `crypto_options` / `key_ctx_bi` | `crypto.h` | 数据通道加解密 key（encrypt / decrypt） | 总体框架 §4.5 |

### 4.4 关键函数

| 函数 | 所在文件 | 职责 | 证据来源 |
| --- | --- | --- | --- |
| `openvpn_main()` | `openvpn.c` | 进程主循环入口 | 总体框架 §5.1 |
| `init_instance()` | `init.c` | 建立 tunnel 运行对象 | 总体框架 §5.2 |
| `do_init_crypto_tls()` | `init.c` | 初始化 TLS root / tls_multi / frame / data cipher | 总体框架 §5.2 |
| `process_io()` | `forward.c` | 报文主分叉点 | 总体框架 §7 |
| `process_incoming_link()` | `forward.c` | 处理外部 socket 入包 | 总体框架 §8 |
| `process_incoming_tun()` | `forward.c` | 处理 TUN/TAP 入包 | 总体框架 §9 |
| `tls_pre_decrypt()` | `ssl.c` | 区分控制包/数据包 | 总体框架 §8 |
| `tls_pre_encrypt()` | `ssl.c` | 选当前数据通道 key / crypto_options | 总体框架 §9 |
| `openvpn_encrypt()` / `openvpn_decrypt()` | `crypto.c` | 数据通道 packet cipher / auth | 总体框架 §9 |
| `init_ssl()` | `ssl.c` | TLS 根上下文建立 | 总体框架 §10.1、上游研究 §3.1 |
| `tls_multi_init()` / `tls_multi_process()` / `tls_process()` | `ssl.c` | 控制通道状态驱动 | 总体框架 §4.4、§10.3 |
| `key_state_ssl_init()` | `ssl_openssl.c` | 单连接 `SSL_new` + Memory BIO | 总体框架 §10.2 |
| `encrypt_sign()` | `forward.c` | 发出方向加密签名 | 总体框架 §9 |
| `key_state_export_keying_material()` | `ssl_openssl.c` | TLS Exporter 导出数据通道密钥材料 | 上游研究 §17 |

### 4.5 状态如何变化

| 阶段 | 进入条件 | 关键状态 | 证据来源 |
| --- | --- | --- | --- |
| 静态配置 | 解析 argv / 配置 | `options` | 总体框架 §4.1 |
| 运行初始化 | `init_instance()` | `context`（c1 / c2） | 总体框架 §5.2 |
| TLS 上下文 | `init_ssl()` | `tls_root_ctx` | 总体框架 §4.3 |
| tunnel TLS 状态 | `tls_multi_init()` | `tls_multi` → `tls_session` → `key_state` | 总体框架 §4.4 |
| 连接级 key state | `key_state_ssl_init()` | `SSL` + Memory BIO | 总体框架 §10.2 |

### 4.6 密钥在哪里产生

| 阶段 | 发生位置 | 说明 | 证据来源 |
| --- | --- | --- | --- |
| 密钥交换（控制通道） | TLS backend（`ssl_openssl.c`） | TLS/TLCP 握手交换数据通道密钥材料 | 总体框架 §11 |
| 密钥派生（数据通道） | OpenVPN Key Method 2（`key_method_2_*()`）；支持 Exporter 的路径用 `SSL_export_keying_material()` | 数据通道 key ≠ TLS record key | 总体框架 §11、上游研究 §17 |
| 会话密钥安装 | `key_state` → `crypto_options` → `key_ctx_bi` | 按代际轮换 | 总体框架 §4.5 |

### 4.7 密码算法在哪里调用

| 用途 | 调用位置 | 是否经过抽象接口 | 证据来源 |
| --- | --- | --- | --- |
| 控制通道 TLS | `ssl_backend.h` → `ssl_openssl.c` | 是（backend 抽象） | 总体框架 §3.1-C、上游研究 §3.2 |
| 数据通道对称加密 | `crypto_backend.h` → `crypto_openssl.c`（EVP 级） | 是（backend 抽象） | 总体框架 §3.1-D |
| 数据通道 cipher 协商 | `ssl_ncp.c`（`data-ciphers` / NCP） | 独立命名空间 | 总体框架 §12 |
| 证书/私钥加载 | `tls_ctx_load_cert_file()` / `tls_ctx_load_priv_file()` | 是 | 上游研究 §6 |

### 4.8 最终数据流向哪里

| 数据 | 路径 | 证据来源 |
| --- | --- | --- |
| 控制通道报文 | OpenVPN 控制消息 ↔ SSL BIO ↔ Tongsuo ↔ `ct_out` / `ct_in` BIO ↔ reliable/control packet ↔ 网络 | 上游研究 §9 |
| 业务流量（发） | TUN/TAP → `process_incoming_tun()` → `encrypt_sign()` → `tls_pre_encrypt()` → `openvpn_encrypt()` → `process_outgoing_link()` → socket | 总体框架 §9 |
| 业务流量（收） | socket → `read_incoming_link()` → `process_incoming_link()` → `tls_pre_decrypt()` → `openvpn_decrypt()` → TUN/TAP | 总体框架 §8 |
| 启用 DCO 时 | 数据通道下沉内核（`dco*.c`），用户态主要承担控制面 | 总体框架 §14 |

### 4.9 国密改造候选层

| 候选改造层 | 覆盖哪些能力 | 改动范围 | 证据来源 |
| --- | --- | --- | --- |
| TLS backend（`ssl_backend.h` / `ssl_openssl.c`） | TLCP method、版本边界、双证书、Provider | 首选接入层 | 上游研究 §4、§18.3 |
| 配置模型（`options.h` / `options.c`） | protocol = TLS/TLCP、SIGN/ENC 双凭据 | 中 | 上游研究 §18.2 |
| 数据通道 crypto（`crypto_backend.h` / `crypto_openssl.c`） | 数据面 SM4 / SM3 | 中（独立于 TLCP） | 上游研究 §16、§18.8 |
| Exporter / 数据通道密钥派生 | TLCP exporter 语义 | 视方案 | 上游研究 §17 |
| DCO 数据面 | 内核数据通道国密 | 视是否启用 DCO | 总体框架 §14 |

## 5. 关联文档

| 文档 | 关系 |
| --- | --- |
| [OpenVPN 2.7.4 总体框架与关键调用流程](OpenVPN%202.7.4%20总体框架与关键调用流程.md) | 本文条目的事实来源（运行框架、对象、调用链） |
| [OpenVPN 设计者视角：进程模型、双通道架构与目录职责](OpenVPN%20设计者视角：进程模型、双通道架构与目录职责.md) | 从设计问题进入目录、文件组、核心对象和阅读优先级 |
| [OpenVPN 全链路数据流与模块协作图解](OpenVPN%20全链路数据流与模块协作图解.md) | 用多级图串起配置、控制通道、数据通道和DCO |
| [OpenVPN 从系统到函数：TLS、Key State 与双通道分层定位图](OpenVPN%20从系统到函数：TLS、Key%20State%20与双通道分层定位图.md) | 从系统层逐级定位核心结构体与函数 |
| [OpenVPN 六链源码精读 01 配置到运行上下文](OpenVPN%20六链源码精读%2001%20配置到运行上下文.md) | 配置文本进入`options`和运行`context` |
| [OpenVPN 六链源码精读 02 控制报文到TLS状态机](OpenVPN%20六链源码精读%2002%20控制报文到TLS状态机.md) | 网络控制报文、可靠层、Memory BIO与TLS状态机 |
| [OpenVPN 六链源码精读 03 TLS握手到数据通道密钥](OpenVPN%20六链源码精读%2003%20TLS握手到数据通道密钥.md) | Key Method、NCP、Exporter与数据密钥初始化 |
| [OpenVPN 六链源码精读 04 TUN明文到外层密文](OpenVPN%20六链源码精读%2004%20TUN明文到外层密文.md) | 用户态数据通道发送链 |
| [OpenVPN 六链源码精读 05 外层报文到TUN明文](OpenVPN%20六链源码精读%2005%20外层报文到TUN明文.md) | 用户态数据通道接收链 |
| [OpenVPN 六链源码精读 06 数据密钥到DCO](OpenVPN%20六链源码精读%2006%20数据密钥到DCO.md) | 数据密钥下沉内核与轮换 |
| [OpenVPN TLS控制通道与Key State生命周期源码精读](OpenVPN%20TLS控制通道与Key%20State生命周期源码精读.md) | 控制通道状态、Session/Key槽位和重协商 |
| [OpenVPN 数据通道包格式、密钥轮换与DCO源码精读附录](OpenVPN%20数据通道包格式、密钥轮换与DCO源码精读附录.md) | P_DATA格式、AEAD/CBC、Key ID与DCO专题 |
| [OpenVPN 上游源码研究与国密改造点定位](OpenVPN%20上游源码研究与国密改造点定位.md) | 本文条目的事实来源（改造点、源码锚点） |
| [OpenVPN Tongsuo 双证书与密钥生命周期附录](OpenVPN%20Tongsuo%20双证书与密钥生命周期附录.md) | 双证书、密钥生命周期的深入来源 |
| [OpenVPN 源码阅读实战方法：从配置与事件循环到双通道数据流](OpenVPN%20源码阅读实战方法：从配置与事件循环到双通道数据流.md) | 学习与培训材料：训练如何独立复原调用链 |
| [国密改造映射矩阵](国密改造映射矩阵.md) | 本文「改造候选层」结论回填到映射矩阵 |

## 参考资料

- 项目内部：[GM-VPN 技术文档写作规范](GM-VPN%20技术文档写作规范.md)、[国密改造映射矩阵](国密改造映射矩阵.md)、上文「关联文档」三篇

本文是索引，不含超出「关联文档」范围的新技术结论。
