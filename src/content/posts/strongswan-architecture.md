---
title: "strongSwan 6.0.3 总体框架与关键调用流程——国密改造底座源码地图"
description: "从 charon、VICI、Job、Task 和插件建立 strongSwan 的总体框架。"
date: "2026-09-29"
updated: "2026-09-29"
category: "vpn"
modules: ["ipsec", "provider", "xfrm"]
editorial: "original"
tags: ["strongSwan", "IKEv2", "strongSwan 架构与方法"]
kind: "源码精读"
minutes: 60
featured: false
series: "strongSwan 架构与方法"
seriesOrder: 1
difficulty: "进阶"
prerequisites: ["按正文的概念解释、源码入口与关联文章补齐前置知识"]
environment: ["原稿整理；本次发布未新增运行实验"]
software: ["strongSwan 6.0.3；源码快照与本地适配边界见正文"]
conclusion: "source"
realVerified: false
verificationActor: "保留原稿的源码分析、资料判断与实验边界；未将文档迁移视为新增实测"
provenance: {"title": "strongSwan 6.0.3 总体框架与关键调用流程——国密改造底座源码地图", "mode": "公开技术节选", "omissions": ["机构称谓与个人本机路径已泛化；技术推导保留"]}
changes: [{"date": "2026-09-29", "note": "收录技术原稿；调整标题层级、网页图示与站内链接。 公开版处理：机构称谓与个人本机路径已泛化；技术推导保留。"}]
repository: "https://github.com/strongswan/strongswan/tree/472dcd8bb50a91f156b725ff56992352b573f7dd"
basis: {"label": "strongSwan 6.0.3 源码", "href": "https://github.com/strongswan/strongswan/tree/472dcd8bb50a91f156b725ff56992352b573f7dd", "boundary": "上游分析、本地适配与实验记录的区别以原文标注为准。"}
---

> 文档定位：底座源码研究，不描述某一份本地 SM4/SM3/SM2 补丁如何实现。  
> 研究基线：strongSwan 6.0.3，官方发布提交 `472dcd8`。  
> 研究目标：在进入 proposal/Transform、SM2/SM3/SM4、GM/T 0022、HSM/PQC 改造前，先建立 strongSwan 自身的进程架构、目录职责、IKEv1/IKEv2 控制面、密码抽象和 Linux XFRM 数据面地图。

> **源码基线与目标实现要分开**
> 本文描述未经国密改造的 strongSwan 6.0.3 上游架构。它用于定位“应在哪里改”，不代表上游已经支持 GM/T 0022，也不代表待采购产品采用相同实现。GM/T 0022 的标准差距单独见《GM/T 0022—2023 与 strongSwan 6.0.3 上游差距分析》。
>

---

## 1. 先建立最重要的认识：strongSwan 不是“一个 IKE 状态机文件”

在 Linux 的典型 strongSwan 部署中，应先分成两大平面：

```text
用户态控制面
swanctl
  ↓
VICI
  ↓
charon/libcharon
  ↓
IKEv1 / IKEv2
  ↓
proposal / crypto / keymat
  ↓
CHILD_SA

────────────────────────────────

内核数据面
kernel interface
  ↓
kernel-netlink
  ↓
Linux XFRM State / Policy
  ↓
ESP/AH 真实数据包处理
```

【官方文档】`charon` 管理 IKE_SA 和 CHILD_SA，CHILD_SA 通过 kernel interface 与内核通信；Linux 常规路径使用 XFRM 安装 IPsec SA 和 policy。

因此研究国密 IPsec 时必须分别证明：

1. IKE 控制面是否真正协商并使用目标算法；
2. CHILD_SA 是否得到正确方向和长度的 ESP keys；
3. kernel-netlink 是否把算法、SPI、key、selector 下发给 Linux；
4. Linux XFRM 是否实际接受并处理 ESP。

“IKE 成功”不等于“ESP 数据面已经成功”。

---

## 2. strongSwan 总体框架图

可以先把 strongSwan 6.0.x 理解成下面八层：

```text
┌─────────────────────────────────────────────┐
│ 1. 管理/配置入口                            │
│ swanctl + swanctl.conf                      │
└──────────────────────┬──────────────────────┘
                       │ VICI
                       ▼
┌─────────────────────────────────────────────┐
│ 2. charon daemon / libcharon                │
│ daemon / controller / backend / IKE manager │
└──────────────────────┬──────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────┐
│ 3. IKE_SA + task manager                    │
│ IKEv1 或 IKEv2                              │
└───────────┬─────────────────────┬───────────┘
            │                     │
            ▼                     ▼
┌──────────────────┐    ┌─────────────────────┐
│ 4. encoding      │    │ 5. crypto framework │
│ message/payload  │    │ proposal/factory    │
│ Transform        │    │ plugin/provider     │
└─────────┬────────┘    └──────────┬──────────┘
          │                        │
          └──────────┬─────────────┘
                     ▼
┌─────────────────────────────────────────────┐
│ 6. keymat + CHILD_SA                        │
│ IKE keys / ESP keys / SPI / TS             │
└──────────────────────┬──────────────────────┘
                       ▼
┌─────────────────────────────────────────────┐
│ 7. kernel interface / kernel-netlink        │
└──────────────────────┬──────────────────────┘
                       ▼
┌─────────────────────────────────────────────┐
│ 8. Linux XFRM / ESP data plane              │
└─────────────────────────────────────────────┘
```

国密改造不会只落在一层，它必须贯穿这条链。

---

## 3. 仓库顶层目录怎么读

strongSwan 仓库很大，不建议从顶层逐目录遍历。

与 VPN 国密研究最相关的源码主要集中在 `src/`。

---

## 4. `src/libstrongswan/`：整个项目的基础能力层

可以把 `libstrongswan` 理解为：

> “不依赖某一种 IKE 状态机的公共基础库。”

重点子目录：

```text
src/libstrongswan/
├── crypto/
├── credentials/
├── plugins/
├── processing/
├── threading/
├── collections/
├── utils/
└── settings/
```

### 4.1 `crypto/`

这是国密算法接入的第一核心目录。

典型结构：

```text
crypto/
├── crypters/
├── hashers/
├── prfs/
├── signers/
├── rngs/
├── key_exchange/
├── proposal/
└── crypto_factory.c
```

它定义的是抽象接口和算法标识，而不是某一个具体 OpenSSL EVP 调用。

可以先建立这样的关系：

```text
crypter_t
  └─ 对称加密

hasher_t
  └─ 无密钥摘要

prf_t
  └─ 带密钥 PRF/KDF 输入

signer_t
  └─ 完整性/MAC

key_exchange_t
  └─ DH/ECDH/KEM 类共享秘密建立
```

【国密改造关注】  
SM4、SM3、SM2/KEM 最合理的接入方式是让上层继续请求这些统一接口，再由插件提供具体实现。

不要在 `main_mode.c`、`ike_init.c`、`keymat_v2.c` 中直接散落 OpenSSL/Tongsuo/厂商 SDK 调用。

---

### 4.2 `crypto/proposal/`

重点文件：

```text
proposal.c
proposal.h
proposal_keywords*.*
```

职责：

把：

```text
用户配置字符串
aes256-sha256-modp2048
```

变成 strongSwan 内部：

```text
Transform Type
+
Algorithm ID
+
Key Size
```

这一级仍然是**内部算法世界**，还不是最终线上 IKE Transform 编号，也不是 Linux XFRM 名称。

【国密改造关注】  
新增 `sm4cbc`、`sm3`、`prfsm3` 等配置能力，第一步通常从这里进入。

---

### 4.3 `crypto_factory.c`

这是 strongSwan 密码插件框架最核心的对象工厂之一。

高层行为：

```text
上层请求：
create_crypter(ENCR_xxx)
          ↓
crypto_factory
          ↓
查找已注册 provider/plugin
          ↓
调用 constructor
          ↓
得到 crypter_t 对象
```

类似地还有：

```text
create_hasher()
create_prf()
create_signer()
create_rng()
create_key_exchange()
```

【国密改造关注】  
“枚举里有 SM4”只证明 strongSwan 知道这个算法名字；只有 crypto factory 能成功构造实现对象，IKE 才真的有机会使用它。

---

### 4.4 `plugins/`

`libstrongswan/plugins/` 是算法、证书和基础能力实现的重要载体。

和国密/HSM 直接相关的典型插件包括：

```text
openssl/
pkcs11/
x509/
pem/
pkcs1/
pkcs8/
random/
nonce/
kdf/
```

`openssl` plugin 通常通过 OpenSSL EVP 提供 crypter、hasher、PRF、key、certificate 等实现。

【国密改造关注】  
如果 Tongsuo 与 OpenSSL API/Provider 兼容，可优先评估复用 openssl plugin 或扩展独立 plugin，而不是改协议层。

HSM 则优先从：

```text
private_key_t
PKCS#11
OpenSSL ENGINE/Provider
```

进入。

---

## 5. `src/libcharon/`：IKE daemon 的真正核心

`libcharon` 是理解 strongSwan 的重点。

官方文档明确：`charon` 的绝大多数核心代码都在 `libcharon`，不同 daemon 前端复用这套 IKE 引擎。

重点目录：

```text
src/libcharon/
├── sa/
├── encoding/
├── network/
├── processing/
├── control/
├── config/
├── kernel/
├── bus/
├── credentials/
└── plugins/
```

---

## 6. `libcharon/daemon.c`：把整个 charon 框架组装起来

核心文件：

```text
src/libcharon/daemon.c
```

它会建立全局 `charon` daemon 对象及多个 manager：

```text
kernel interface
attribute manager
controller
backend manager
socket manager
trap manager
shunt manager
bus
...
```

可以先把它理解成“依赖注入总装配点”。

它本身不负责具体 IKEv2 第几条消息，但它创建了后续状态机依赖的全局服务。

---

## 7. charon 的线程/Job 架构

strongSwan 不应按“一个连接一个阻塞线程”来理解。

官方 charon architecture 的关键组件包括：

```text
receiver
scheduler
processor/thread pool
IKE_SA manager
IKE_SA
CHILD_SA
sender
kernel interface
```

### Processor

所有 worker thread 由 processor 管理。

各种任务被包装为 job 后进入队列，由线程池异步执行。

### Scheduler

负责定时事件：

```text
rekey
retransmit
DPD
delete
lifetime
```

Scheduler 不直接跑复杂协议逻辑，而是到时把 job 交给 processor。

### IKE_SA Manager

这是理解并发的关键。

官方架构说明强调：

```text
IKE_SA 被 checkout
    ↓
只有一个线程可操作该 IKE_SA
    ↓
处理结束
    ↓
checkin
```

因此 IKE_SA 内部复杂逻辑可以避免自己到处加锁。

【国密改造关注】  
后续做 HSM 慢操作、远程密码服务或阻塞 Provider 时，要意识到它可能长期占用 IKE_SA checkout 和 worker thread，不能只看密码 API 本身。

---

## 8. `src/swanctl/`：现代配置与控制入口

strongSwan 6.0 推荐：

```text
swanctl
+
VICI
```

而不是旧的 stroke/ipsec.conf 路线。

重点：

```text
src/swanctl/
src/swanctl/commands/
```

例如：

```text
load_conns.c
initiate.c
list_sas.c
load_creds.c
```

`load_conns.c::load_conn()` 会把 `swanctl.conf` 中连接配置组织成 VICI `load-conn` 请求发送给 charon。

---

## 9. VICI：配置如何进入 charon

charon 侧重点目录：

```text
src/libcharon/plugins/vici/
```

重要文件：

```text
vici_config.c
vici_control.c
vici_dispatcher.c
vici_socket.c
```

高层链：

```text
swanctl.conf
   ↓
swanctl load_conns.c
   ↓
VICI "load-conn"
   ↓
vici_config.c
   ↓
ike_cfg
peer_cfg
child_cfg
```

### 三种配置对象

#### `ike_cfg`

更偏 IKE 层：

- local/remote address；
- IKE proposal；
- IKE version；
- transport/socket 参数。

#### `peer_cfg`

代表一个 peer connection 的总体策略：

- authentication；
- IKE config；
- reauth/rekey；
- child configs；
- connection behavior。

#### `child_cfg`

代表 CHILD_SA/ESP 层配置：

- ESP/AH proposal；
- traffic selectors；
- mode tunnel/transport；
- lifetime；
- start/trap action。

【国密改造关注】  
IKE 算法和 ESP 算法不是同一个配置对象。做国密时必须分别确认 IKE proposal 和 child proposal。

---

## 10. 发起连接的控制链

现代路径可以先记成：

```text
swanctl --initiate
     ↓
VICI request
     ↓
vici_control.c
     ↓
controller.c
     ↓
IKE_SA manager
     ↓
创建/复用 ike_sa_t
     ↓
ike_sa->initiate()
     ↓
task_manager
```

`controller` 是外部控制请求到 IKE_SA 运行对象之间的重要桥梁。

它不是 IKE 报文状态机本身。

---

## 11. `IKE_SA`：控制面的中心对象

重点：

```text
src/libcharon/sa/ike_sa.c
src/libcharon/sa/ike_sa.h
```

一个 `ike_sa_t` 可以理解为一条 IKE 安全关联的“总运行对象”。

它持有或关联：

```text
IKE SA state
local/remote host
SPIs
peer_cfg
keymat
task_manager
CHILD_SA list
conditions/extensions
statistics/timers
```

并提供：

```text
initiate()
process_message()
rekey()
delete()
add_child_sa()
...
```

后续不论 IKEv1 还是 IKEv2，都不会绕过 IKE_SA。

---

## 12. Task Manager：为什么 strongSwan 的状态机不是一个大 switch

统一入口：

```text
src/libcharon/sa/task_manager.c
```

它根据 IKE version 创建：

```text
IKEv1 → task_manager_v1
IKEv2 → task_manager_v2
```

真正协议行为继续拆成一个个 task。

这是一种很重要的架构思想：

```text
IKE_SA
   ↓
Task Manager
   ↓
一组可组合 task
```

而不是把所有协议写在 `ike_sa.c` 一个巨大状态机中。

---

## 13. 收到 IKE 报文的真实框架

网络入口可以抽象为：

```text
UDP 500/4500
   ↓
socket plugin
   ↓
network receiver
   ↓
packet/message parsing
   ↓
process_message_job
   ↓
IKE_SA manager checkout
   ↓
ike_sa->process_message()
   ↓
task_manager_v1/v2
   ↓
具体 task
```

处理完成后 IKE_SA 再 checkin。

这是定位“为什么这个函数会被运行”的关键调用链。

你读任何 `main_mode.c` 或 `child_create.c` 时都应该知道它上面还有这套 job + manager 框架。

---

## 14. `encoding/`：线上报文到底怎么生成/解析

重点目录：

```text
src/libcharon/encoding/
```

重点：

```text
message.c
generator.c
parser.c
payloads/
```

### `message.c`

表示一条 IKE message：

```text
IKE header
+
payload list
+
加密/完整性处理
```

### `payloads/`

包括：

- SA payload；
- Proposal；
- Transform；
- KE；
- Nonce；
- ID；
- AUTH；
- Certificate；
- Traffic Selector；
- Notify；
- Delete；
- CP 等。

【国密改造关注】  
如果改动只涉及“算法 ID 映射”，通常优先落在 proposal/Transform encoding；如果目标标准改变 payload 结构或认证输入语义，才需要进入 task/message/payload 的更深层。

---

## 15. IKEv1 框架

目录：

```text
src/libcharon/sa/ikev1/
├── task_manager_v1.c
├── keymat_v1.c
└── tasks/
```

重要 task：

```text
main_mode.c
aggressive_mode.c
quick_mode.c
informational.c
mode_config.c
xauth.c
isakmp_natd.c
...
```

可以先把 IKEv1 主链记成：

```text
Phase 1
Main Mode / Aggressive Mode
      ↓
建立 IKE/ISAKMP SA
      ↓
keymat_v1
SKEYID / 派生 IKE 密钥
      ↓
Phase 2
Quick Mode
      ↓
协商 ESP/AH proposal
      ↓
派生 CHILD/ESP keys
      ↓
CHILD_SA
      ↓
XFRM
```

### GM/T 0022 路线为什么确定要改得比 IKEv2 算法扩展深

GM/T 0022—2023 不仅新增 SM4/SM3 算法编号，还明确改变：

- 身份认证算法；
- SM2 签名输入；
- 密钥交换方式；
- HASH 计算输入；
- Certificate/ID 处理；
- Transform Attribute 定义；

则除了：

```text
proposal
crypto plugin
keymat
```

还必须进入：

```text
main_mode
payload 编解码
quick_mode
authenticator/credential
```

原因是标准使用 1.1 报文画像、签名/加密双证书、SM2 数字信封和专用 SKEYID/IV/HASH 公式，而上游 Main Mode 使用 1.0、DH `KE + Nonce` 和 RFC 风格 keymat。因此 GM/T 0022 不能简单等价成“原 IKEv1 把 AES/SHA 换成 SM4/SM3”。

---

## 16. IKEv2 框架

目录：

```text
src/libcharon/sa/ikev2/
├── task_manager_v2.c
├── keymat_v2.c
└── tasks/
```

典型 task：

```text
ike_init.c
ike_auth.c
child_create.c
ike_rekey.c
child_rekey.c
ike_delete.c
child_delete.c
ike_mobike.c
ike_config.c
...
```

主链：

```text
IKE_SA_INIT
   ↓
ike_init
   ├─ proposal
   ├─ KE
   └─ nonce
   ↓
keymat_v2
建立 IKE SA keys
   ↓
IKE_AUTH
   ↓
ike_auth
认证双方
   ↓
通常同时建立首个 CHILD_SA
   ↓
child_create
   ↓
ESP proposal + traffic selectors
   ↓
CHILD keys
   ↓
child_sa
   ↓
XFRM
```

后续新的 CHILD、rekey 等继续通过 CREATE_CHILD_SA 类任务管理。

---

## 17. IKEv1 和 IKEv2 共用什么，不共用什么

### 共用的底层能力

```text
proposal_t
crypto_factory
crypter/hasher/prf/signer
credential framework
child_sa
kernel interface
kernel-netlink
```

### 不共用的协议状态机

```text
IKEv1 task_manager + main/quick mode
IKEv2 task_manager + ike_init/ike_auth/child_create
```

### 不共用的 keymat 公式

```text
keymat_v1
≠
keymat_v2
```

【国密改造关注】  
“OpenSSL 插件支持 SM3 PRF”可以让两个版本都具备候选算法对象，但不代表 IKEv1 和 IKEv2 的派生公式或线上 Transform 编码就自动完成了。

---

## 18. proposal 到真实密码对象

这条链是 strongSwan 国密改造的核心骨架：

```text
配置字符串
   ↓
proposal parser
   ↓
proposal_t
   ↓
Transform Type + internal Algorithm ID
   ↓
IKEv1 / IKEv2 线上编码
   ↓
协商选中 proposal
   ↓
keymat / task 请求算法
   ↓
crypto_factory
   ↓
plugin constructor
   ↓
crypter_t / prf_t / signer_t / ...
```

三个概念一定要分开：

```text
strongSwan internal Algorithm ID
        ≠
IKE wire Transform ID
        ≠
Linux XFRM algorithm name
```

详细映射已经放在独立的 Proposal→Transform→Crypto Factory→Keymat→XFRM 附录中。

---

## 19. Keymat：密码算法真正进入协议计算的位置之一

### IKEv1

```text
src/libcharon/sa/ikev1/keymat_v1.c
```

负责：

```text
IKE Phase 1 key material
+
Quick Mode / CHILD key derivation
```

### IKEv2

```text
src/libcharon/sa/ikev2/keymat_v2.c
```

负责：

```text
SKEYSEED
→ SK_d
→ SK_ai / SK_ar
→ SK_ei / SK_er
→ SK_pi / SK_pr
```

以及 CHILD_SA key derivation。

【国密改造关注】  
keymat 应继续依赖 `prf_t`、`crypter_t` 等抽象接口。SM3 实现应来自 crypto provider，而不是直接写在 keymat 中。

---

## 20. `CHILD_SA`：控制面和数据面的交界

重点：

```text
src/libcharon/sa/child_sa.c
src/libcharon/sa/child_sa.h
```

CHILD_SA 不只是“一个 ESP key”。

它会维护：

```text
inbound/outbound SPI
protocol ESP/AH
proposal
traffic selectors
mode
reqid
marks
lifetime
state
```

安装时还要处理：

```text
encryption key
integrity key
direction
source/destination
policy
```

这是 IKE 协商结果变成真实数据面状态的关键对象。

---

## 21. Kernel Interface：strongSwan 不应该把 Linux 写死在 IKE task 里

`libcharon` 有统一 kernel interface。

Linux 下常见 provider 是：

```text
kernel-netlink plugin
```

其他系统也可以有不同实现。

因此上层：

```text
child_sa
```

调用的是抽象 kernel interface，而不是直接在 `child_create.c` 里拼 Netlink。

这是 strongSwan 可移植性的关键。

---

## 22. `kernel-netlink`：Linux XFRM 接口

重点目录：

```text
src/libcharon/plugins/kernel_netlink/
```

关键文件：

```text
kernel_netlink_ipsec.c
kernel_netlink_net.c
kernel_netlink_shared.c
```

### `kernel_netlink_ipsec.c`

负责 IPsec/XFRM 数据面：

```text
SA
policy
SPI
algorithm
key
lifetime
replay
mark
if_id
...
```

### `kernel_netlink_net.c`

更偏普通网络：

```text
address
route
interface
```

【源码确认】`kernel_netlink_ipsec.c` 内部维护 strongSwan algorithm ID 到 Linux Crypto API algorithm name 的映射，例如 AES、GCM、Camellia 等。

【国密改造关注】  
即使用户态 crypto plugin 能创建 SM4 对象，ESP 数据面仍需 Linux Crypto API/XFRM 接受对应名称和参数。

---

## 23. Linux XFRM 是谁真正处理 ESP

典型 Linux 路线：

```text
strongSwan
    ↓ Netlink
XFRM State
    +
XFRM Policy
    ↓
Linux kernel
    ↓
ESP encrypt/decrypt
```

charon 并不会对每个业务 IP 包调用 OpenSSL `EVP_CipherUpdate()`。

所以：

```text
OpenSSL/Tongsuo 支持 SM4
```

和：

```text
Linux XFRM 支持 cbc(sm4)
```

是两个完全不同的条件。

这也是 IPsec 国密改造和 OpenVPN 用户态 data channel 改造最大的架构区别之一。

---

## 24. `libipsec`：为什么还会看到用户态 ESP

strongSwan 还有：

```text
src/libipsec/
```

它提供用户态 IPsec/ESP 能力，可通过 `kernel-libipsec` 等方案使用。

这不是 Linux 默认 `kernel-netlink + XFRM` 路线。

研究时要先确认产品架构选择：

```text
A. Linux XFRM 数据面
还是
B. libipsec 用户态数据面
```

不能把两个实现路径的密码调用混在一起。

你当前研究主线应继续以：

```text
kernel-netlink
→ Linux XFRM
```

为主。

---

## 25. 证书和认证框架

strongSwan 的证书/私钥并不只属于 IKEv1 或 IKEv2。

公共 credential abstraction 位于 `libstrongswan`，配合插件提供：

```text
X.509
PEM
PKCS#8
PKCS#11
OpenSSL key
public key
private_key_t
```

协议 task 在认证阶段通过统一对象使用这些凭据。

【国密改造关注】  
SM2 身份认证应优先进入：

```text
certificate/public key/private key abstraction
+
signature scheme/crypto provider
```

然后确认 IKEv1/IKEv2 AUTH/HASH 输入是否符合目标规范。

不要在 `main_mode.c` 里直接读取厂商 HSM 文件或调用 SDK。

---

## 26. HSM 在底座里应该怎么理解

HSM 主要改变的是：

```text
私钥对象“在哪里执行”
```

而不是：

```text
IKE task 怎么排队
proposal 怎么协商
CHILD_SA 怎么安装
```

推荐边界：

```text
IKE task
   ↓
private_key_t / signature interface
   ↓
PKCS#11 / OpenSSL Provider / ENGINE
   ↓
HSM
```

这样协议状态机仍保持干净。

---

## 27. PQC 在底座里应该怎么理解

strongSwan 6.x 已有统一的：

```text
key_exchange_t
```

以及 KEM/附加密钥交换等可扩展方向。

对 PQC 的正确思路是先判断：

```text
proposal/Transform 如何表达
        ↓
key_exchange_t 如何返回 shared secret
        ↓
keymat 如何合并 secret
        ↓
IKE task 如何携带必要 payload/notify
```

而不是先在 IKEv2 task 中硬编码某个 KEM SDK。

---

## 28. 一条完整的“配置到 ESP”主流程

这是 strongSwan 最值得背下来的总体链：

```text
swanctl.conf
   ↓
swanctl load_conn()
   ↓
VICI
   ↓
vici_config
   ↓
ike_cfg / peer_cfg / child_cfg
   ↓
controller / initiate
   ↓
IKE_SA
   ↓
task_manager_v1 或 task_manager_v2
   ↓
proposal / Transform
   ↓
crypto_factory
   ↓
真实密码对象
   ↓
keymat
   ↓
IKE keys / CHILD keys
   ↓
child_sa
   ↓
kernel interface
   ↓
kernel-netlink
   ↓
XFRM State / Policy
   ↓
ESP
```

这条链就是以后审国密 Diff 时的主检查表。

---

## 29. 一条完整的“收到 IKE 包”主流程

```text
UDP 500/4500
   ↓
socket plugin
   ↓
receiver
   ↓
process_message_job
   ↓
ike_sa_manager checkout
   ↓
ike_sa->process_message()
   ↓
task_manager
   ↓
具体 IKEv1/IKEv2 task
   ↓
message/payload 解析与处理
   ↓
状态改变 / keymat / CHILD install
   ↓
生成 response
   ↓
sender
```

如果你以后问：

> “为什么 `child_create.c` 会在此时执行？”

就应该从这条运行链回答，而不是只说“因为这是创建 CHILD 的函数”。

---

## 30. 国密研究最需要关注的目录，不需要关注整个仓库

建议优先级：

```text
P0
src/libstrongswan/crypto/
src/libstrongswan/plugins/openssl/
src/libcharon/sa/
src/libcharon/encoding/payloads/
src/libcharon/plugins/kernel_netlink/
src/libcharon/plugins/vici/
src/swanctl/

P1
src/libstrongswan/credentials/
src/libstrongswan/plugins/pkcs11/
src/libcharon/network/
src/libcharon/processing/
src/libcharon/control/

P2
src/libipsec/
其他 EAP/AAA/HA/mediation 等按产品需求再看
```

---

## 31. 哪些地方尽量不要作为第一改造点

### 不要优先改 `daemon.c`

它是框架组装，不是算法语义中心。

### 不要优先在 `receiver/sender` 中处理国密

它们主要负责消息收发和调度。

### 不要在 `child_sa.c` 直接调用 OpenSSL SM4

CHILD_SA 应保存算法和 key，再交给 kernel interface。

### 不要因为 IKEv1 需要国密就重写整个 task manager

先判断差异属于：

```text
算法实现？
Transform 编号？
KDF？
认证语义？
还是报文状态机？
```

只有最后一种才需要真正深改 protocol task。

---

## 32. 故障现象如何映射到底座层

### 配置加载失败

优先查：

```text
swanctl
→ VICI
→ vici_config
→ proposal parser
```

### 发出 SA Proposal 但对端不接受

优先查：

```text
proposal
→ Transform wire encoding
→ 双方编号/语义
```

### IKE 协商到某一步报 “algorithm not supported”

优先查：

```text
crypto_factory
→ plugin registration
→ constructor
→ OpenSSL/Tongsuo provider
```

### IKE 成功但 CHILD_SA 建立失败

优先查：

```text
child_create / quick_mode
→ derive_child_keys
→ child_sa
```

### CHILD_SA 日志显示成功但没有 XFRM state

优先查：

```text
kernel interface
→ kernel-netlink
→ Netlink ACK
```

### XFRM state 存在但业务流量不通

继续查：

```text
XFRM policy
traffic selector
route
algorithm availability
direction/SPI
ESP packet
```

这时不能再只盯 IKE。

---

## 33. 推荐源码阅读顺序

建议从“框架”到“协议”再到“数据面”：

```text
1. src/libcharon/daemon.c
   先看 charon 由哪些 manager 组成

2. 官方 charon architecture
   processor / scheduler / receiver / IKE_SA manager

3. src/swanctl/commands/load_conns.c
   配置怎么进 VICI

4. src/libcharon/plugins/vici/vici_config.c
   配置怎么变成 cfg 对象

5. src/libcharon/control/controller.c
   initiate 怎么进入 IKE_SA

6. src/libcharon/sa/ike_sa.c
   认识中心运行对象

7. src/libcharon/sa/task_manager.c
   看 IKEv1/IKEv2 分叉

8. ikev1/task_manager_v1.c
   main_mode.c / quick_mode.c

9. ikev2/task_manager_v2.c
   ike_init.c / ike_auth.c / child_create.c

10. encoding/message.c + payloads/
    看线上消息

11. libstrongswan/crypto/proposal/
    配置算法到内部 proposal

12. libstrongswan/crypto/crypto_factory.c
    内部算法到真实对象

13. keymat_v1.c / keymat_v2.c
    密钥派生

14. child_sa.c
    IKE 结果到 IPsec SA

15. kernel_netlink_ipsec.c
    用户态到 XFRM
```

读完这 15 步，就有足够底座理解去做国密 IKE/IPsec 改造。

---

## 34. 只读源码导航命令

```bash
# daemon 框架
rg -n 'daemon_create|initialize|start' src/libcharon/daemon.c

# 配置入口
rg -n 'load_conn' src/swanctl/commands src/libcharon/plugins/vici

# 发起连接
rg -n 'initiate_execute|initiate\\(' src/libcharon/control src/libcharon/sa

# IKE SA
rg -n 'process_message|task_manager_create|add_child_sa' src/libcharon/sa

# IKEv1 task
rg -n 'main_mode|aggressive_mode|quick_mode' src/libcharon/sa/ikev1

# IKEv2 task
rg -n 'ike_init|ike_auth|child_create|ike_rekey|child_rekey' \
  src/libcharon/sa/ikev2

# message / payload
rg -n 'generate|parse|proposal_substructure|transform_substructure' \
  src/libcharon/encoding

# proposal
rg -n 'proposal_create|add_string_algo|check_proposal' \
  src/libstrongswan/crypto/proposal

# crypto factory
rg -n 'create_crypter|create_hasher|create_prf|create_signer|create_ke' \
  src/libstrongswan/crypto

# keymat
rg -n 'derive_ike_keys|derive_child_keys' \
  src/libcharon/sa/ikev1 src/libcharon/sa/ikev2

# CHILD_SA
rg -n 'install_internal|install_policies|add_sa' src/libcharon/sa/child_sa.c

# XFRM
rg -n 'encryption_algs|integrity_algs|add_sa|add_policy|send_ack' \
  src/libcharon/plugins/kernel_netlink/kernel_netlink_ipsec.c
```

---

## 35. 与国密专项文档如何衔接

本文件只负责把 strongSwan 底座讲到：

```text
proposal
→ Transform
→ crypto abstraction
→ keymat
→ CHILD_SA
→ XFRM
```

后续《Proposal→Transform→Crypto Factory→Keymat→XFRM 源码精读附录》再深入回答：

- 内部 Algorithm ID 怎么定义；
- IKEv1 wire ID 怎么转换；
- IKEv2 Transform 怎么编码；
- crypto factory 怎么选 provider；
- SM3 PRF/Integrity 为什么不能混；
- keymat 怎么按方向切 keys；
- Linux XFRM 名称怎么映射。

GM/T 0022 专项已独立建立：

```text
1.1 profile
→ Main Mode M1-M6
→ 双证书/SM2 数字信封
→ 专用 keymat
→ Quick Mode
→ XFRM
```

详见《GM/T 0022—2023 与 strongSwan 6.0.3 上游差距分析》。IKEv2 部分继续作为国际协议底座和独立算法扩展路线研究，不与 GM/T 0022 合规链混写。

---

## 36. 一句话总结

strongSwan 的核心不是“把 IKE 包解析出来”，而是一套插件化、任务化、控制面/数据面分离的 VPN 框架：

```text
配置/VICI
→ IKE_SA
→ task manager
→ IKEv1/IKEv2 tasks
→ proposal + crypto factory
→ keymat
→ CHILD_SA
→ kernel interface
→ Linux XFRM
```

国密改造应尽量复用 strongSwan 的抽象边界，但复用范围必须服从目标标准。对于只扩展 IKEv2 算法的路线，可优先停留在算法、Transform、provider 和 XFRM；对于 GM/T 0022 路线，标准已经改变 IKEv1 消息语义和 keymat，因此必须进入 Main Mode、payload、双证书/认证和 Quick Mode 的专用实现。

---

## 参考依据

### 源码

- `strongswan/strongswan`，版本 `6.0.3`
- 官方 release commit：`472dcd8`
- 重点目录：`src/libstrongswan/`、`src/libcharon/`、`src/swanctl/`

### 官方资料

- strongSwan 6.0 Documentation
- charon Architecture
- Configuration Files / swanctl / VICI
- Plugin List
- IKE and IPsec SA Renewal
- kernel-netlink 相关配置说明
- strongSwan GitHub source tree

> 注：本文件以“目录 + 文件 + 函数 + 对象关系”为稳定源码锚点。精确行号应在实际锁定的 `472dcd8` 源码快照或采购源码基线上重新生成，避免不同补丁集导致行号漂移。
