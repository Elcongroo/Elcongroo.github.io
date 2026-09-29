---
title: "strongSwan 全链路数据流与模块协作图解"
description: "用配置、报文、密钥与业务包的数据流串起模块协作。"
date: "2026-09-29"
updated: "2026-09-29"
category: "vpn"
modules: ["ipsec", "xfrm"]
editorial: "original"
tags: ["strongSwan", "IKEv2", "strongSwan 架构与方法"]
kind: "源码精读"
minutes: 40
featured: false
series: "strongSwan 架构与方法"
seriesOrder: 3
difficulty: "进阶"
prerequisites: ["按正文的概念解释、源码入口与关联文章补齐前置知识"]
environment: ["原稿整理；本次发布未新增运行实验"]
software: ["strongSwan 6.0.3；源码快照与本地适配边界见正文"]
conclusion: "source"
realVerified: false
verificationActor: "保留原稿的源码分析、资料判断与实验边界；未将文档迁移视为新增实测"
provenance: {"title": "strongSwan 全链路数据流与模块协作图解", "mode": "原稿收录", "omissions": []}
changes: [{"date": "2026-09-29", "note": "收录技术原稿；调整标题层级、网页图示与站内链接。"}]
repository: "https://github.com/strongswan/strongswan/tree/472dcd8bb50a91f156b725ff56992352b573f7dd"
basis: {"label": "strongSwan 6.0.3 源码", "href": "https://github.com/strongswan/strongswan/tree/472dcd8bb50a91f156b725ff56992352b573f7dd", "boundary": "上游分析、本地适配与实验记录的区别以原文标注为准。"}
---

> 研究基线：strongSwan 6.0.3 上游源码，commit `472dcd8bb50a91f156b725ff56992352b573f7dd`<br>
> 研究目标：用由粗到细的流程图串起配置、IKE、密码、CHILD_SA、Linux XFRM 与业务报文<br>
> 边界：本文描述默认的 `charon + kernel-netlink + Linux XFRM` 路线；`kernel-libipsec` 用户态 ESP 是另一条可选路线

## 1. 先纠正一个最重要的理解

“数据在 strongSwan 中流动”其实包含四种完全不同的数据：

| 数据类型 | 例子 | 主要经过哪里 | 最终作用 |
| --- | --- | --- | --- |
| 配置数据 | 地址、证书、IKE/ESP proposal、流量选择器 | `swanctl → VICI → config objects` | 告诉 charon 应建立什么连接 |
| IKE 控制报文 | IKE_SA_INIT、IKE_AUTH、Main Mode、Quick Mode | `socket → receiver/sender → task_manager → task` | 协商算法、认证身份、建立 SA |
| 密钥与 SA 元数据 | SPI、方向密钥、算法、Traffic Selector | `keymat → child_sa → kernel interface` | 把协商结果安装到内核 |
| 业务 IP 报文 | 用户访问内网的 TCP/UDP/IP 包 | Linux 路由与 XFRM | 匹配策略后封装成 ESP |

必须牢记：

> **charon 主要处理前三类数据。采用默认 Linux XFRM 数据面时，隧道建立后的每个业务包不会再回到 charon。**

这就是后面所有图的总线索。

## 2. 图一：一张全景图先建立坐标

```mermaid
flowchart TB
    A["管理员<br/>swanctl.conf / swanctl 命令"]
    P["IKE 对端<br/>UDP 500 / 4500"]
    APP["本机或转发的业务 IP 包"]

    subgraph U["用户态：strongSwan"]
        V["VICI 配置与控制接口"]
        CFG["配置对象<br/>ike_cfg / peer_cfg / child_cfg"]
        SA["运行对象<br/>IKE_SA"]
        TM["任务编排<br/>task_manager_v1 / v2"]
        TASK["协议任务<br/>Main/Quick 或 INIT/AUTH/CHILD"]
        MSG["报文系统<br/>message / payload / sender / receiver"]
        CRYPTO["密码与凭据框架<br/>proposal / crypto factory / credential manager"]
        KM["密钥派生<br/>keymat_v1 / keymat_v2"]
        CHILD["CHILD_SA<br/>SPI / 算法 / 方向密钥 / TS"]
        KI["内核抽象<br/>kernel_interface"]
    end

    subgraph K["内核态：Linux"]
        NL["kernel-netlink"]
        XP["XFRM Policy<br/>哪些流量必须使用 IPsec"]
        XS["XFRM State<br/>SPI / 算法 / 密钥 / 序列号"]
        LC["Linux Crypto API"]
        ESP["ESP 封装 / 解封装"]
    end

    A -->|"加载配置 / 发起连接"| V
    V --> CFG --> SA --> TM --> TASK
    P <-->|"IKE 控制报文"| MSG
    MSG <--> TM
    TASK <--> CRYPTO
    TASK --> KM --> CHILD --> KI --> NL
    NL --> XP
    NL --> XS

    APP -->|"路由后匹配策略"| XP
    XP --> XS --> LC --> ESP
    ESP -->|"公网 ESP 或 UDP 4500"| P
```

### 这张图应该看懂什么

1. 配置先变成对象，不会直接变成内核规则。
2. `IKE_SA` 是一次 IKE 会话的总运行对象；`task_manager` 在其中编排多个协议任务。
3. 密码插件提供“怎么算”，task 和 keymat 决定“什么时候算、输入是什么、结果用于哪里”。
4. `CHILD_SA` 把协商结果组织成内核能安装的形式。
5. XFRM 安装完成后，业务报文走内核，不经过 IKE 状态机。

## 3. 图二：配置怎样变成运行中的 IKE_SA

```mermaid
flowchart LR
    F["swanctl.conf<br/>连接、认证、children"]
    CLI["swanctl --load-conns"]
    LC["load_conns.c<br/>load_conn()"]
    VC["VICI 请求<br/>load-conn"]
    VCFG["vici_config.c<br/>解析配置"]

    ICFG["ike_cfg<br/>地址、IKE版本、IKE proposal"]
    PCFG["peer_cfg<br/>身份认证、连接总体策略"]
    CCFG["child_cfg<br/>ESP proposal、TS、模式、生命周期"]

    START["swanctl --initiate<br/>VICI initiate"]
    CTRL["controller.c<br/>initiate() / initiate_execute()"]
    MGR["ike_sa_manager<br/>checkout / create / checkin"]
    ISA["ike_sa.c<br/>IKE_SA 运行对象"]
    TM["task_manager_create()<br/>按 IKEv1 / IKEv2 分叉"]

    F --> CLI --> LC --> VC --> VCFG
    VCFG --> ICFG
    VCFG --> PCFG
    VCFG --> CCFG

    START --> CTRL --> MGR --> ISA --> TM
    ICFG -.-> ISA
    PCFG -.-> ISA
    CCFG -.-> ISA
```

### 配置对象为什么分成三个

- `ike_cfg`：回答“跟谁建立哪一种 IKE SA”。
- `peer_cfg`：回答“双方如何证明身份，以及整条连接采用什么策略”。
- `child_cfg`：回答“哪些业务网段进入隧道，ESP 使用什么算法和模式”。

因此一个常见排障规律是：

```text
IKE proposal 错误 → 看 ike_cfg
身份认证错误     → 看 peer_cfg
ESP/网段/模式错误 → 看 child_cfg
```

### 源码锚点

```text
src/swanctl/commands/load_conns.c
  load_conn()

src/libcharon/plugins/vici/vici_config.c
  parse_proposal()
  parse_rules / parse_sections 相关配置解析

src/libcharon/control/controller.c
  initiate()
  initiate_execute()

src/libcharon/sa/ike_sa_manager.c
src/libcharon/sa/ike_sa.c
  initiate()
```

## 4. 图三：一个 IKE 报文怎样进入、处理并发回网络

### 4.1 接收方向

```mermaid
sequenceDiagram
    participant Peer as 对端
    participant Sock as socket plugin
    participant Recv as receiver.c
    participant Pool as processor/job queue
    participant Job as process_message_job
    participant Mgr as ike_sa_manager
    participant SA as IKE_SA
    participant TM as task_manager
    participant Task as 当前协议 task

    Peer->>Sock: UDP 500/4500 报文
    Sock->>Recv: packet_t
    Recv->>Recv: message_create_from_packet<br/>解析 IKE Header、限流/Cookie检查
    Recv->>Pool: process_message_job_create(message)
    Pool->>Job: 工作线程执行
    Job->>Mgr: checkout_by_message(message)
    Mgr-->>Job: 已有或新建的 IKE_SA
    Job->>SA: process_message(message)
    SA->>TM: process_message(message)
    TM->>Task: 按交换类型和当前状态处理 Payload
    Task-->>TM: NEED_MORE / SUCCESS / FAILED
    TM-->>SA: 更新 task 队列与 IKE_SA 状态
    Job->>Mgr: checkin 或 checkin_and_destroy
```

### 4.2 发送方向

```mermaid
sequenceDiagram
    participant Ctrl as controller / timer / received request
    participant SA as IKE_SA
    participant TM as task_manager
    participant Task as protocol task
    participant Msg as message.c
    participant Send as sender.c
    participant Sock as socket plugin
    participant Peer as 对端

    Ctrl->>SA: initiate() 或 queue_task()
    SA->>TM: initiate()
    TM->>Task: build(message)
    Task->>Msg: 添加 SA/KE/Nonce/ID/AUTH 等 Payload
    Msg->>Msg: generate_message()<br/>编码、加密、完整性、必要时分片
    Msg->>Send: packet_t
    Send->>Sock: sender(packet)
    Sock->>Peer: UDP 500/4500 报文
```

### `task_manager` 为什么是核心

`task_manager` 不是密码算法，也不是单个协议状态机。它更像一个项目经理：

- 根据 IKE 版本选择 v1 或 v2 实现；
- 维护主动、被动和排队中的 task；
- 把收到的消息交给正确 task；
- 处理重传、并发交换、失败和任务销毁；
- 让多个 task 共同完成一次 IKE/CHILD_SA 生命周期。

### 源码锚点

```text
src/libcharon/network/receiver.c
  receive_packets()

src/libcharon/processing/jobs/process_message_job.c
  execute()

src/libcharon/sa/ike_sa_manager.c
  checkout_by_message()

src/libcharon/sa/ike_sa.c
  process_message()
  generate_message()

src/libcharon/sa/ikev1/task_manager_v1.c
src/libcharon/sa/ikev2/task_manager_v2.c
  initiate()
  process_message()

src/libcharon/network/sender.c
  send()
```

## 5. 图四：IKEv1 与 IKEv2 在哪里分叉，又在哪里汇合

```mermaid
flowchart TB
    ISA["IKE_SA 创建"] --> VER{"IKE 版本"}

    VER -->|"IKEv1"| TM1["task_manager_v1"]
    VER -->|"IKEv2"| TM2["task_manager_v2"]

    subgraph V1["IKEv1 上游路线"]
        MM["Main Mode / Aggressive Mode<br/>建立 IKE SA"]
        KM1["keymat_v1<br/>SKEYID_d / a / e"]
        QM["Quick Mode<br/>建立 IPsec SA"]
        TM1 --> MM --> KM1 --> QM
    end

    subgraph V2["IKEv2 上游路线"]
        INIT["ike_init<br/>SA + KE + Nonce"]
        KM2["keymat_v2<br/>SK_d / SK_a / SK_e / SK_p"]
        AUTH["ike_auth<br/>ID + CERT + AUTH"]
        CC["child_create<br/>首个 CHILD 常随 IKE_AUTH 携带<br/>后续使用 CREATE_CHILD_SA"]
        TM2 --> INIT --> KM2 --> AUTH --> CC
    end

    QM --> COMMON["共同结果：选定 ESP proposal<br/>双向 SPI + 双向 KEYMAT + TS"]
    CC --> COMMON
    COMMON --> CHILD["child_sa"]
    CHILD --> XFRM["kernel interface → XFRM"]

    GMT["GM/T 0022 注意<br/>不是给上游 IKEv1 只换算法<br/>还需 1.1 profile、双证书、数字信封、专用 keymat"]
    GMT -.-> MM
    GMT -.-> KM1
    GMT -.-> QM
```

### 分叉与汇合的本质

分叉的是控制面协议：

```text
IKEv1：Main/Aggressive + Quick Mode + keymat_v1
IKEv2：IKE_SA_INIT + IKE_AUTH + CREATE_CHILD_SA + keymat_v2
```

汇合的是结果表达：两条路线最终都要产生 `CHILD_SA` 所需的 proposal、SPI、方向密钥和 Traffic Selector，再交给统一的 kernel interface。

这就是为什么：

- 改 IKEv1 状态机不会自动改 IKEv2；
- 增加一个密码插件可能被 v1/v2 共用；
- ESP/XFRM 数据面可由 v1/v2 共同复用；
- GM/T 0022 的 IKEv1 深改与“IKEv2 加 SM 算法”必须分开描述。

## 6. 图五：Proposal、密码插件、证书和 keymat 怎样协作

```mermaid
flowchart TB
    CONF["配置字符串<br/>例如 IKE/ESP proposal"]
    KW["proposal keywords<br/>名字 → 内部算法 ID"]
    PROP["proposal_t<br/>Transform 类型 + 算法 ID + Key Size"]
    WIRE["proposal_substructure<br/>内部 ID ↔ 线上 Transform/Attribute"]
    SELECT["双方 proposal 取交集"]

    FACTORY["crypto_factory"]
    PLUGINS["密码插件<br/>openssl / gcrypt / wolfssl / pkcs11 等"]
    OBJ["密码对象<br/>crypter / aead / prf / signer / hasher / key_exchange"]

    CREDS["credential_manager"]
    SETS["credential sets<br/>证书、私钥、共享密钥"]
    AUTHN["authenticator<br/>生成或验证身份认证数据"]

    KM["keymat_v1 / keymat_v2<br/>按协议公式派生密钥"]
    IKEKEY["IKE SA 密钥<br/>保护后续 IKE 报文"]
    CHILDKEY["CHILD_SA 方向密钥<br/>交给数据面"]
    GATE["认证结果<br/>决定连接能否被接受"]
    INSTALL["允许安装/启用 CHILD_SA"]

    CONF --> KW --> PROP --> WIRE --> SELECT
    SELECT --> FACTORY
    FACTORY --> PLUGINS --> OBJ

    SETS --> CREDS --> AUTHN
    OBJ --> AUTHN
    SELECT --> KM
    OBJ --> KM
    KM --> IKEKEY
    KM --> CHILDKEY
    IKEKEY -->|"保护认证所在的后续交换"| AUTHN
    AUTHN --> GATE
    GATE --> INSTALL
    CHILDKEY --> INSTALL
```

### 四个对象各自负责什么

| 对象 | 负责 | 不负责 |
| --- | --- | --- |
| `proposal_t` | 表达希望/选中了什么算法 | 不执行密码运算 |
| `crypto_factory` + plugin | 根据算法 ID 创建真实密码对象 | 不决定协议消息顺序和 KDF 输入 |
| `credential_manager` + authenticator | 找证书/私钥并完成身份认证；认证结果决定连接能否被接受 | 不负责 IKE 初始密钥的 KDF，也不安装 ESP SA |
| `keymat_v1/v2` | 在认证完成前就可按对应协议公式生成 IKE 密钥，并继续生成 CHILD 密钥 | 不替代身份认证，默认也不逐包处理 ESP 业务流量 |

这里的时间顺序很重要：密钥交换和 Nonce 先让双方派生保护 IKE 后续消息所需的密钥，身份认证再在受保护的上下文中证明“对端是谁”。不能把“身份认证通过”误解成 IKE 初始密钥的输入条件；它是接受连接和启用协商结果的安全门槛。

因此“OpenSSL/Tongsuo 支持 SM4”最多证明密码原语可用。要证明国密 IPsec，还要继续证明 proposal、线上编号、协议公式、CHILD_SA 和 XFRM 全链成立。

## 7. 图六：CHILD_SA 如何把协商结果安装进 Linux

```mermaid
sequenceDiagram
    participant Task as quick_mode / child_create
    participant KM as keymat_v1 / keymat_v2
    participant Child as child_sa
    participant KI as kernel_interface
    participant KN as kernel_netlink_ipsec
    participant X as Linux XFRM

    Task->>KM: derive_child_keys(proposal, nonces, SPI, optional KE)
    KM-->>Task: encr_i / integ_i / encr_r / integ_r
    Task->>Child: 设置 proposal、TS、模式与方向
    Task->>Child: install(inbound SA)
    Child->>KI: add_sa(SPI, 算法, 密钥, 端点, 方向)
    KI->>KN: 选择 kernel-netlink 后端
    KN->>X: Netlink XFRM_MSG_NEWSA
    X-->>KN: 成功或具体 errno
    Task->>Child: install(outbound SA)
    Child->>KI: add_sa(...)
    KN->>X: 安装反方向 State
    Child->>KI: add_policy(TS, direction, reqid)
    KN->>X: Netlink XFRM_MSG_NEWPOLICY
    X-->>Child: State + Policy 安装结果
    Child-->>Task: CHILD_SA installed
```

### 为什么至少要两条 State

IPsec SA 是单向的。双向通信通常需要：

```text
出站 SA：本机加密 → 对端解密
入站 SA：对端加密 → 本机解密
```

它们具有不同 SPI、方向密钥和序列号状态。Traffic Selector 则进一步生成/关联 XFRM Policy，决定哪些业务包可以使用这些 State。

### 源码锚点

```text
src/libcharon/sa/ikev1/tasks/quick_mode.c
src/libcharon/sa/ikev2/tasks/child_create.c

src/libcharon/sa/child_sa.c
  install() / install_internal()

src/libcharon/kernel/kernel_interface.c
  add_sa()
  add_policy()

src/libcharon/plugins/kernel_netlink/kernel_netlink_ipsec.c
  add_sa()
  add_policy()
```

## 8. 图七：隧道建立后，一个业务包的一生

### 8.1 出站方向

```mermaid
sequenceDiagram
    participant App as 应用或被转发主机
    participant Route as Linux 路由
    participant Policy as XFRM Policy
    participant State as XFRM State
    participant Crypto as Linux Crypto API
    participant NIC as 网卡
    participant Peer as 对端网关

    App->>Route: 原始明文 IP 包
    Route->>Policy: 检查目标、源、协议、mark/if_id 等
    Policy->>State: 按 reqid/方向/模板找到出站 SA
    State->>State: 读取 SPI、序列号、密钥、算法
    State->>Crypto: ESP 加密与完整性/AEAD
    Crypto-->>State: ESP 密文、ICV/Tag
    State->>NIC: 外层 IP + ESP<br/>NAT-T 时为 UDP 4500 + ESP
    NIC->>Peer: 公网密文包
```

### 8.2 入站方向

```mermaid
sequenceDiagram
    participant Peer as 对端网关
    participant NIC as 网卡
    participant State as XFRM State
    participant Crypto as Linux Crypto API
    participant Policy as XFRM Policy
    participant Route as Linux 路由 / Netfilter
    participant App as 本机应用或内网主机

    Peer->>NIC: 外层 IP + ESP / UDP 4500
    NIC->>State: 根据 SPI、目的地址、协议查找入站 SA
    State->>State: 检查序列号与抗重放窗口
    State->>Crypto: 验证 ICV/Tag 并解密
    Crypto-->>State: 恢复内层明文 IP 包
    State->>Policy: 检查该包是否满足入站策略
    Policy->>Route: 重新进入路由/转发流程
    Route->>App: 交付本机或转发至内网
```

### 这张图最关键的结论

`charon` 没有出现在图中。这不是遗漏，而是默认架构本身：

```text
charon 负责谈判并安装规则
Linux XFRM 负责长期逐包执行
```

因此：

- `IKE_SA established` 只证明控制面走到一定阶段；
- `CHILD_SA established` 还应结合 `ip xfrm state/policy` 证明内核安装；
- `ping` 成功仍需结合外层 PCAP，排除流量绕路；
- strongSwan 链接 Tongsuo 不代表内核 ESP 自动调用 Tongsuo。

## 9. 图八：运行期间谁负责 rekey、DPD 和删除

```mermaid
flowchart LR
    TIMER["scheduler / 生命周期定时器"]
    NET["对端报文或网络事件"]
    SA["IKE_SA"]
    QUEUE["task_manager task queue"]

    REKEY["IKE/CHILD rekey task"]
    DPD["DPD / liveness task"]
    DELETE["delete / expire task"]

    NEW["协商并安装新 SA"]
    SWITCH["切换到新 SA"]
    OLD["删除旧 SA / Policy"]

    TIMER --> SA
    NET --> SA
    SA --> QUEUE
    QUEUE --> REKEY --> NEW --> SWITCH --> OLD
    QUEUE --> DPD -->|"对端存活"| SA
    DPD -->|"超时"| DELETE
    QUEUE --> DELETE --> OLD
```

首次建链成功并不代表实现完整。协议、国密算法或 HSM 接入都必须继续验证：

- CHILD_SA rekey 后是否仍使用目标算法；
- 新旧 SPI 是否平滑切换；
- DPD、删除和重连是否清理旧 XFRM 状态；
- 并发 rekey 时是否出现重复 SA、锁竞争或短时断流；
- HSM/密码卡会话是否随 SA 生命周期正确释放。

## 10. 图九：看到故障时，从哪一层开始查

```mermaid
flowchart TD
    START["连接或业务失败"] --> Q1{"配置能加载吗"}
    Q1 -->|"否"| C1["swanctl / VICI / vici_config<br/>语法、proposal token、证书路径"]
    Q1 -->|"能"| Q2{"发出或收到 IKE 包吗"}

    Q2 -->|"没有"| C2["controller / IKE_SA / task_manager<br/>sender / receiver / socket / 防火墙"]
    Q2 -->|"有"| Q3{"算法协商和 KE 成功吗"}

    Q3 -->|"否"| C3["proposal_substructure / proposal selection<br/>crypto factory / key_exchange / wire ID"]
    Q3 -->|"是"| Q4{"身份认证成功吗"}

    Q4 -->|"否"| C4["credential_manager / certificate<br/>authenticator / ID / 签名输入"]
    Q4 -->|"是"| Q5{"CHILD_SA 安装成功吗"}

    Q5 -->|"否"| C5["keymat / child_sa / kernel-netlink<br/>内核算法、密钥长度、Netlink errno"]
    Q5 -->|"是"| Q6{"业务包进入正确 XFRM Policy 吗"}

    Q6 -->|"否"| C6["路由 / TS / Policy / mark / if_id<br/>防火墙、NAT、方向"]
    Q6 -->|"是但不通"| C7["State/SPI/方向密钥、抗重放<br/>MTU/分片、对端路由、防火墙"]
```

### 最小证据组合

| 层 | 最有用的证据 |
| --- | --- |
| 配置层 | `swanctl --list-conns`、加载错误、最终 proposal |
| IKE 报文层 | 双方 charon 日志、UDP 500/4500 PCAP |
| 认证层 | 证书链、ID、AUTH 验证日志；不得记录私钥 |
| CHILD_SA 层 | `swanctl --list-sas`、协商后的 ESP proposal |
| 内核层 | `ip xfrm state`、`ip xfrm policy`、Netlink 错误 |
| 业务层 | 内外接口 PCAP、路由、计数器、MTU/分片结果 |

## 11. 把九张图压缩成一句调用链

```text
swanctl 配置/命令
→ VICI
→ ike_cfg / peer_cfg / child_cfg
→ controller
→ IKE_SA
→ task_manager_v1/v2
→ 具体协议 task
→ message/payload + crypto/credential
→ keymat
→ CHILD_SA
→ kernel_interface
→ kernel-netlink
→ XFRM State/Policy
→ Linux Crypto API
→ ESP 业务流量
```

如果你能够对着这条链回答下面五个问题，就已经建立了 strongSwan 的整体源码坐标：

1. 当前处理的是配置、IKE 报文、密钥元数据还是业务包？
2. 当前在用户态 charon，还是已经进入 Linux 内核？
3. 当前对象是 `IKE_SA` 还是 `CHILD_SA`？
4. 当前失败属于协商、认证、派生、安装还是流量命中？
5. 应该用源码、日志、PCAP 还是 XFRM 状态证明结论？

## 12. 建议的源码阅读顺序

不要按目录从头通读。按照数据流逐段进入：

```text
第一遍：图一 + 图四 + 图七
        只建立控制面/数据面与 v1/v2 分叉

第二遍：vici_config.c → controller.c → ike_sa.c
        看配置怎样变成运行对象

第三遍：receiver.c → process_message_job.c → task_manager
        看一个 IKE 报文怎样被调度

第四遍：一个具体 task + keymat
        IKEv2 可选 ike_init；IKEv1 可选 main_mode

第五遍：child_sa.c → kernel_interface.c → kernel_netlink_ipsec.c
        看协商结果怎样进入 XFRM
```

## 13. 本文结论的边界

### 已由上游源码确认

- 配置经 swanctl/VICI 进入三类配置对象；
- `IKE_SA` 持有按版本创建的 task manager；
- receiver 将消息交给工作队列，随后按 IKE_SA 串行处理；
- v1/v2 使用不同 task 与 keymat，但最终汇合到 `CHILD_SA`；
- `child_sa` 经 kernel interface 和 kernel-netlink 安装 XFRM SA/Policy；
- 默认内核数据面中，业务 ESP 包不逐包经过 charon。

### 尚待采购代码核查

- 厂商实际 strongSwan 版本、补丁和目录结构；
- 是否使用 `kernel-netlink`、`kernel-libipsec` 或自研/硬件数据面；
- GM/T 0022、IKEv2 SM 扩展、密码卡和 HSM 的实际落点；
- Web 管理配置如何映射到 strongSwan 配置对象；
- 产品是否改写 task、keymat、credential 或 XFRM 安装路径。

## 关联文档

- [strongSwan 源码导览](strongSwan%20源码导览.md)
- [strongSwan 6.0.3 总体框架与关键调用流程](strongSwan%206.0.3%20总体框架与关键调用流程.md)
- [strongSwan IKEv2 状态机与密钥生命周期源码精读](strongSwan%20IKEv2%20状态机与密钥生命周期源码精读.md)
- [GM/T 0022—2023 与 strongSwan 6.0.3 上游差距分析](GM-T%200022-2023%20与%20strongSwan%206.0.3%20上游差距分析.md)
- [strongSwan Proposal 到 XFRM 源码精读附录](strongSwan%20Proposal%20到%20XFRM%20源码精读附录.md)
