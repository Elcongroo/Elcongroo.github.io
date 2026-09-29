---
title: "strongSwan / IPsec / IKEv1 / IKEv2 上游源码研究与国密改造点定位"
description: "沿公开上游扩展点定位国密算法、认证、协议和内核数据面边界。"
date: "2026-09-29"
updated: "2026-09-29"
category: "crypto"
modules: ["ipsec", "crypto", "provider"]
editorial: "original"
tags: ["strongSwan", "IKEv2", "国密协议与改造"]
kind: "源码精读"
minutes: 60
featured: false
series: "国密协议与改造"
seriesOrder: 3
difficulty: "进阶"
prerequisites: ["按正文的概念解释、源码入口与关联文章补齐前置知识"]
environment: ["原稿整理；本次发布未新增运行实验"]
software: ["strongSwan 6.0.3；源码快照与本地适配边界见正文"]
conclusion: "source"
realVerified: false
verificationActor: "保留原稿的源码分析、资料判断与实验边界；未将文档迁移视为新增实测"
provenance: {"title": "strongSwan / IPsec / IKEv1 / IKEv2 上游源码研究与国密改造点定位", "mode": "原稿收录", "omissions": []}
changes: [{"date": "2026-09-29", "note": "收录技术原稿；调整标题层级、网页图示与站内链接。"}]
repository: "https://github.com/strongswan/strongswan/tree/472dcd8bb50a91f156b725ff56992352b573f7dd"
basis: {"label": "strongSwan 6.0.3 源码", "href": "https://github.com/strongswan/strongswan/tree/472dcd8bb50a91f156b725ff56992352b573f7dd", "boundary": "上游分析、本地适配与实验记录的区别以原文标注为准。"}
---

### 1. 文档目的与研究边界

#### 1.1 项目定位

本文把 strongSwan 作为成熟 IPsec/IKE 开源底座进行源码分析。当前结论针对**未经国密改造的上游代码**，用于回答：若以 strongSwan 6.0.3 实现 GM/T 0022—2023，标准要求与上游实现的差距落在哪些源码边界。

这些结论可作为后续审查待采购源码的参照，但在拿到产品源码、版本清单和构建结果前，不能反向推断厂商一定使用 strongSwan、一定采用相同文件结构，或已经完成本文列出的改造。

本文研究的是**未叠加本项目补丁的 strongSwan 上游架构**。它回答的不是“在哪几个文件加一个 SM4 枚举”，而是完整回答一条链：

```text
配置中的一个算法名字
    ↓
怎样变成 proposal 内部算法 ID
    ↓
怎样编码到 IKEv1 / IKEv2 报文 Transform
    ↓
怎样创建真实密码对象
    ↓
怎样参与 IKE 密钥派生
    ↓
怎样产生 CHILD_SA 密钥
    ↓
怎样把 SPI / 算法 / 密钥交给 Linux XFRM
    ↓
ESP 包最终由谁加密
```

只有这条链闭合，才能判断一个“国密 IPsec 改造”是否真正成立。

本文同时专门区分五类对象：

1. **IKEv1 上游框架**；
2. **国密 IKEv1 目标改造点**；
3. **IKEv2 上游框架**；
4. **ESP 数据面**；
5. **密码实现与协议编号**。

#### 1.2 研究边界

| 项 | 内容 |
| --- | --- |
| 研究基线 | strongSwan 6.0.3，release commit `472dcd8bb50a91f156b725ff56992352b573f7dd` |
| 标准边界 | GM/T 0022—2023《IPSec VPN 技术规范》。该标准采用 IKEv1/ISAKMP 衍生的两阶段体系，报文版本为 1.1；IKEv2 + SM 算法是另一条扩展路线，不属于本文所称 GM/T 0022 合规路径 |
| 行号口径 | 函数名是长期锚点；行号是 6.0.3 研究快照锚点。换干净 release tarball 或叠加补丁后，须用文末 `rg -n` 重新生成行号 |

#### 1.3 证据标注

本文遵循《GM-VPN 技术文档写作规范》第 12 章的六类标注：

| 标注 | 含义 |
| --- | --- |
| 【源码确认】 | 已在 6.0.3 上游源码中定位到函数、字段或调用关系 |
| 【运行确认】 | 已通过调试或日志确认 |
| 【抓包确认】 | 已通过 PCAP 确认 |
| 【标准定义】 | 来自 GM/T、RFC 或官方规范 |
| 【推测】 | 基于源码结构得出的工程判断（含“改造点”类结论），推理依据见所在段落 |
| 【待验证】 | 静态源码无法证明，需编译、日志、断点、抓包或互通测试确认 |

本文的“改造点”结论属于【推测】类：它们是**从上游源码结构推导出的候选修改位置**，不表示这些修改已经在产品中完成。

---

### 2. 先建立最重要的系统边界

strongSwan 主要负责 IPsec 的**用户态控制面**，Linux XFRM 通常负责 ESP **内核数据面**。

```text
                用户态

swanctl / VICI configuration
          │
          ▼
ike_cfg / peer_cfg / child_cfg
          │
          ▼
        IKE_SA
          │
    task_manager v1/v2
          │
          ▼
 proposal / authentication / key exchange
          │
          ▼
 crypto factory + plugins
          │
          ▼
     keymat v1/v2
          │
          ▼
       CHILD_SA
          │
          ▼
  kernel interface / netlink

========================================
                内核态

       Linux XFRM SA / Policy
          │
          ▼
      ESP encrypt/decrypt
```

这张图首先消除两个常见误区：

> strongSwan 使用 OpenSSL/Tongsuo，并不表示 ESP 数据包由 OpenSSL 在用户态逐包加密。

以及：

> IKE SA 协商成功，也不表示 CHILD_SA 已经成功安装到 XFRM。

---

### 3. strongSwan 6.0.3 的核心对象模型

阅读 strongSwan 时不要先陷入 task 文件，而应先认识几个对象。

#### 3.1 `ike_cfg_t`

表示 IKE 连接层面的配置，例如 IKE proposal、地址等。

#### 3.2 `peer_cfg_t`

把 IKE 配置、认证配置、CHILD 配置组合成一个对端连接配置。

#### 3.3 `child_cfg_t`

描述要建立的 ESP/AH CHILD_SA，包括 ESP proposal、流量选择器、模式、生命周期等。

#### 3.4 `proposal_t`

这是理解国密算法如何进入协商的核心对象。

它保存的不是字符串，而是若干：

```text
Transform Type
Algorithm ID
Key Size
```

例如抽象上：

```text
ENCRYPTION_ALGORITHM -> AES-CBC -> 256
PSEUDO_RANDOM_FUNCTION -> HMAC-SHA2-256
INTEGRITY_ALGORITHM -> HMAC-SHA2-256-128
KEY_EXCHANGE_METHOD -> MODP/ECP/...
```

国密改造同样必须先进入这个统一模型。

#### 3.5 `ike_sa_t`

运行中的 IKE 安全关联。它持有协商状态、配置、任务队列、keymat 等运行对象。

#### 3.6 `task_manager_t`

根据 IKE 版本创建并驱动不同 task。

```text
IKEv1 -> task_manager_v1
IKEv2 -> task_manager_v2
```

#### 3.7 `keymat_t / keymat_v1_t / keymat_v2_t`

负责不同 IKE 版本的密钥派生，不负责决定算法字符串，也不负责 ESP 逐包加密。

#### 3.8 `child_sa_t`

持有最终 CHILD_SA 的方向、SPI、算法和密钥，并把它们交给 kernel interface。

---

### 4. 从 `swanctl.conf` 到运行中 `IKE_SA`

这一段是“配置为什么会变成运行行为”的主链。

#### 4.1 swanctl 发送配置

源码锚点：

```text
src/swanctl/commands/load_conns.c
    load_conn()              （6.0.3 研究快照约 233 行）
```

`swanctl --load-conns` 不直接创建 IKE socket 或密码对象，而是构造 VICI `load-conn` 请求。

#### 4.2 charon VICI 配置后端接收

```text
src/libcharon/plugins/vici/vici_config.c
    parse_proposal()         （约 643 行）
    load_conn()              （约 3018 行）
```

这里把配置字符串变成 strongSwan 内部配置对象。

主要产物：

```text
ike_cfg
peer_cfg
child_cfg
proposal_t
```

#### 4.3 发起连接

```text
src/libcharon/plugins/vici/vici_control.c
    initiate()               （约 173 行）

src/libcharon/control/controller.c
    initiate_execute()       （约 436 行）

src/libcharon/sa/ike_sa.c
    initiate()               （约 1577 行）
```

随后进入 task 系统。

#### 4.4 根据版本选择 task manager

```text
src/libcharon/sa/task_manager.c
    task_manager_create()    （约 89 行）
```

概念上：

```text
configured IKE version
      │
      ├─ IKEv1 -> task_manager_v1_create()
      └─ IKEv2 -> task_manager_v2_create()
```

这意味着：

> 国密算法注册可以共享，但 IKEv1 和 IKEv2 的报文编码、任务状态机、keymat 不能混成一条链来分析。

---

### 5. Proposal：国密算法改造的第一道门

#### 5.1 配置词不是协议编号

strongSwan 配置中写：

```text
aes256-sha256-modp2048
```

首先经过 proposal keyword/token 机制，把字符串转换为内部算法表示。

源码：

```text
src/libstrongswan/crypto/proposal/proposal_keywords_static.txt
src/libstrongswan/crypto/proposal/proposal.c
```

重点函数：

```text
proposal.c
    add_string_algo()      （6.0.3 研究快照约 854 行）
    check_proposal()       （约 699 行）
```

`add_string_algo()` 的核心职责是：

```text
配置 token
  ↓
proposal token registry
  ↓
(type, algorithm, keysize)
  ↓
proposal_t::add_algorithm()
```

#### 5.2 国密算法必须分角色注册

如果目标需要 SM3，不能只添加一个 `SM3` ID。

至少要区分：

```text
HASH_SM3
    无密钥摘要

PRF_HMAC_SM3
    带密钥 PRF，用于 IKE KDF

AUTH_HMAC_SM3_xxx
    带密钥完整性算法，用于 IKE/ESP integrity
```

因为 strongSwan 内部接口本来就是分开的：

```text
hasher_t
prf_t
signer_t
```

同一个底层 SM3 digest 被用于三个角色，不代表三个 Transform 可以共用一个枚举。

#### 5.3 需要研究/改造的枚举入口

典型位置：

```text
src/libstrongswan/crypto/crypters/crypter.h
src/libstrongswan/crypto/hashers/hasher.h
src/libstrongswan/crypto/prfs/prf.h
src/libstrongswan/crypto/signers/signer.h
src/libstrongswan/crypto/key_exchange.h
```

如果增加 SM4/SM3，通常先要在这里给 strongSwan 内部算法一个明确身份。

但到这一步仍然只是：

```text
配置能认识这个名字
```

还不能证明：

```text
IKE 报文能发出正确 Transform
密码对象能创建
密钥能派生
ESP 能安装
```

---

### 6. Proposal 检查为什么重要

`proposal.c:check_proposal()` 不只是语法检查，它检查一个 proposal 是否满足对应协议所需的 Transform 类型。

例如 IKE proposal 通常需要：

```text
Encryption
PRF
Integrity（非 AEAD 情况）
Key Exchange
```

而 ESP proposal 的要求不同。

因此国密改造时必须问：

> 新增的 `SM4 + HMAC-SM3 + PRF-HMAC-SM3` 是否被放在了正确 Transform Type？

如果把 `HASH_SM3` 当作 `PRF_HMAC_SM3`，即使代码能编译，proposal 的语义也是错的。

---

## Part I：IKEv1 上游源码与国密版改造点

### 7. IKEv1 不是一个函数，而是一组 task

IKEv1 task manager：

```text
src/libcharon/sa/ikev1/task_manager_v1.c
```

该文件组织 IKEv1 的不同任务，包括：

```text
main_mode
aggressive_mode
quick_mode
informational
xauth/mode_config（按配置）
```

因此阅读 IKEv1 时，应该按交换阶段拆开。

---

### 8. IKEv1 第一阶段：Main Mode / Aggressive Mode

重点目录：

```text
src/libcharon/sa/ikev1/tasks/
    main_mode.c
    aggressive_mode.c
```

主要职责：

```text
协商 IKE SA proposal
       ↓
完成 Key Exchange / Nonce
       ↓
派生 IKEv1 SKEYID 系列
       ↓
完成身份认证
       ↓
建立 IKE SA
```

#### 8.1 对 GM/T 0022 而言，已经可以确定是状态机深改

GM/T 0022—2023 不是“可能改变”上游 IKEv1 交换语义，而是已经明确规定了不同的 1.1 协议画像：

```text
M1  HDR, SA
M2  HDR, SA, CERT_sig_r, CERT_enc_r
M3  HDR, XCH_i, SIG_i
M4  HDR, XCH_r, SIG_r
M5  HDR*, HASH_i
M6  HDR*, HASH_r
```

其中 M3/M4 使用 SM2 数字信封传递临时对称密钥，并用该临时密钥保护 Nonce 和 ID。上游 `main_mode.c` 则在 M3/M4 发送 DH `KE + Nonce`，在 M5/M6 发送 `ID + AUTH`。

所以 GM/T 0022 路线必须进入：

```text
main_mode.c 状态与消息内容
payload type 128 的编码/解析
签名/加密双证书角色
SM2 数字信封与专用认证器
keymat_v1 的派生输入和公式
```

“只换算法、保留原状态机”只能描述非标准实验或另行约定的 IKEv1 扩展，不能描述 GM/T 0022 合规实现。完整差距见《GM/T 0022—2023 与 strongSwan 6.0.3 上游差距分析》。

---

### 9. IKEv1 Transform 编码是一个独立改造点

strongSwan 内部算法 ID 和 IKEv1 线上编号不是同一层。

核心文件：

```text
src/libcharon/encoding/payloads/proposal_substructure.c
```

重点函数锚点：

```text
add_to_proposal_v1_ike()      （约 894 行）
add_to_proposal_v1()          （约 946 行）
set_from_proposal_v1_ike()    （约 1291 行）
set_from_proposal_v1()        （约 1362 行）
```

可以分为两个方向理解。

#### 9.1 接收报文

```text
IKEv1 线上 Transform/Attribute
       ↓
proposal_substructure.c
       ↓
strongSwan internal Algorithm ID
       ↓
proposal_t
```

#### 9.2 发送报文

```text
proposal_t internal Algorithm ID
       ↓
proposal_substructure.c
       ↓
IKEv1 线上 Transform/Attribute
```

所以一个新增国密算法至少存在两个编号世界：

```text
内部 ID
≠
线上 IKEv1 ID
```

#### 9.3 GM/T 0022 的编号必须在 1.1 profile 中解释

标准已经给出了第一阶段 SM4=`129`、SM3=`20`、数字信封认证=`10`，以及 ESP SM4-CBC=`127`、SM4-GCM=`130`、HMAC-SM3=`20` 等值。实现仍须逐项核对：

```text
IKE Encryption Transform/Attribute
IKE Hash/PRF 表达
Authentication Method
Key Exchange 表达
ESP Encryption Transform
ESP Authentication Transform
Key length / ICV truncation
```

上游已有的普通 IKEv1 编号空间可能与这些数值发生语义冲突。例如上游把认证方法值 `10` 映射为 ECDSA-384，而 GM/T 0022 的 1.1 profile 把 `10` 定义为数字信封认证。因此解析键必须是：

```text
协议版本/profile + 字段类型 + 数值
```

不能全局重定义整数，也不能把 IKEv1 国标编号复制到 IKEv2。若双方另外使用私有编号做实验，应明确标记：

```text
private / experimental interoperability contract
```

而不是写成公开标准编号。

---

### 10. IKEv1 keymat：算法不是在 proposal 里真正“算”的

核心文件：

```text
src/libcharon/sa/ikev1/keymat_v1.c
```

重点职责：

```text
derive_ike_keys()
derive_child_keys()
```

IKEv1 的关键过程可概括为：

```text
共享秘密 / 认证材料 / Nonce / Cookie
       │
       ▼
选定 PRF
       │
       ▼
SKEYID
SKEYID_d
SKEYID_a
SKEYID_e
       │
       ├─ IKE encryption/integrity keys
       └─ Quick Mode / CHILD key material
```

#### 10.1 密码接口可复用，但 GM/T 派生公式不能沿用上游

`PRF_HMAC_SM3` 仍应通过 `prf_t` 和 crypto factory 提供，而不是把 `EVP_sm3()` 硬编码进协议层：

```text
prf->set_key()
prf->get_bytes()/allocate_bytes()
```

而不是在 `keymat_v1.c` 中直接调用：

```text
EVP_sm3()
HMAC(...)
```

但上游 `derive_ike_keys()` 的公式依赖 DH 共享秘密 `g^xy`，GM/T 0022 的公式不含 `g^xy`，并以 `HASH(Ni | Nr)`、Cookie 以及数字信封产生的 `Sk_i/Sk_r` 为输入。初始 IV 也从上游的 `HASH(g^xi | g^xr)` 变为 `HASH(Sk_i | Sk_r)`。

因此正确边界是：**复用 `prf_t` 抽象，重写 GM/T profile 的派生数据流和公式**，而不是只把 PRF 对象换成 HMAC-SM3。

---

### 11. IKEv1 Quick Mode：从 IKE SA 到 ESP CHILD_SA

核心文件：

```text
src/libcharon/sa/ikev1/tasks/quick_mode.c
```

Quick Mode 负责 IKEv1 下的 CHILD/ESP SA 建立。

逻辑主线：

```text
ESP proposal
 + Nonce
 + 可选 PFS KE
       │
       ▼
keymat_v1->derive_child_keys()
       │
       ▼
encr_i / integ_i
encr_r / integ_r
       │
       ▼
child_sa->install()
```

因此：

> SM4/SM3 进入 IKEv1 proposal 只完成了“谈什么算法”；真正进入 ESP SA 的是 Quick Mode + `derive_child_keys()` 产生的方向密钥。

---

### 12. “完整 GM/T 0022 路线”至少包含哪些改造层

如果公司目标是符合明确国密 IPSec VPN 规范的 IKEv1，而不是只做 SM4/SM3 算法实验，至少要逐层证明：

#### 12.1 SM4 对称加密

需要：

```text
内部 crypter algorithm ID
proposal keyword
IKEv1 wire mapping
crypto provider/crypter implementation
key size / IV / block size
ESP XFRM mapping
```

#### 12.2 SM3 无密钥摘要

需要 `hasher_t` 能力，供真正需要 digest 的代码使用。

#### 12.3 HMAC-SM3 PRF

需要：

```text
prf_t
```

用于 IKE keymat。

#### 12.4 HMAC-SM3 完整性

需要：

```text
signer_t
```

并定义：

```text
key length
full HMAC output
协议要求的 ICV truncation
```

不能把 PRF 输出长度和 ESP ICV 长度混为一谈。

#### 12.5 SM2 身份认证

这是很多“SM4/SM3 改造”最容易漏掉的一层。

需要研究：

```text
credentials/
public_key_t / private_key_t
certificate_t / x509
signature scheme
openssl plugin / pkcs11 / engine/provider
IKEv1 authentication task
```

只有 SM4 + SM3 没有 SM2 身份链，不能称为完整国密 IKEv1。

#### 12.6 SM2 数字信封密钥交换

GM/T 0022 已经明确要求该语义。它不能直接映射为 strongSwan 现有 `key_exchange_t` + DH KE payload，需要进入：

```text
key_exchange_t
IKEv1 main/aggressive task
payload 编解码
keymat 输入
```

---

## Part II：IKEv2 上游源码与国密改造点

### 13. IKEv2 的研究定位：国际协议与算法扩展，不等于 GM/T 0022

本 Part 保留，是为了理解 strongSwan 的 IKEv2 上游架构及未来 IKEv2 + SM/PQC 扩展。它不描述 GM/T 0022 合规路线。

#### 13.1 IKEv2 的 task 分层比 IKEv1 更清晰

核心：

```text
src/libcharon/sa/ikev2/task_manager_v2.c
```

典型任务顺序：

```text
IKE_SA_INIT
    │
    ├─ SA proposal
    ├─ KE
    └─ Nonce
    ▼
IKE_AUTH
    │
    ├─ identity
    ├─ certificate
    └─ authentication
    ▼
Initial CHILD_SA

后续：CREATE_CHILD_SA / rekey / delete / informational
```

---

### 14. IKEv2 `IKE_SA_INIT`：proposal、KE、Nonce 的汇合点

核心文件：

```text
src/libcharon/sa/ikev2/tasks/ike_init.c
```

它使用：

```text
proposal_t
key_exchange_t
nonce payload
SA payload
keymat_v2
```

所以 IKEv2 国密接入时，应先问：

1. proposal 是否能表达目标 SM4/SM3 Transform；
2. Transform ID 是否有正式编号或约定编号；
3. `crypto_factory` 是否能创建算法对象；
4. KE 是否能由 `key_exchange_t` 表达；
5. `keymat_v2` 是否只需要更换 PRF，还是 KDF 语义也要变化。

---

### 15. IKEv2 Transform 编码

同样在：

```text
src/libcharon/encoding/payloads/proposal_substructure.c
```

IKEv2 的 Transform 模型本身就是：

```text
Transform Type + Transform ID + Attributes
```

这比 IKEv1 的 DOI/Attribute 映射更统一。

重点函数：

```text
encode_transforms_v2()       （6.0.3 研究快照约 1464 行）
```

**【推测】**：如果项目另行定义 IKEv2 国密算法扩展，并且双方认同同一 Transform ID/profile，那么主要需要：

```text
内部 enum/token
+ Transform ID
+ crypto provider
+ keymat 参数
```

而不一定要重写 IKEv2 状态机。

但“直接把 strongSwan 内部私有 ID 原样写到 wire”只能作为实验约定，不能自动变成标准实现。

---

### 16. IKEv2 keymat

核心文件：

```text
src/libcharon/sa/ikev2/keymat_v2.c
```

重点职责：

```text
derive_ike_keys()
derive_child_keys()
```

IKEv2 IKE key material 的典型输出：

```text
SK_d
SK_ai / SK_ar
SK_ei / SK_er
SK_pi / SK_pr
```

CHILD key material：

```text
encr_i
integ_i
encr_r
integ_r
```

方向是协议语义的一部分，不能只检查“生成了四块相同长度内存”。

#### 16.1 对 SM3 的启示

如果国密 profile 使用 HMAC-SM3 PRF，那么：

```text
PRF_HMAC_SM3
```

必须提供正确 PRF 语义和输出长度。

如果 ESP integrity 使用截断 HMAC-SM3，则：

```text
AUTH_HMAC_SM3_xxx
```

由 signer/integrity 接口负责截断。

keymat 不应该自己硬编码“SM3 截 16 字节”。

---

### 17. IKEv2 CHILD_SA 创建

核心文件：

```text
src/libcharon/sa/ikev2/tasks/child_create.c
```

在 6.0.3 研究快照中，约 770-815 行附近可看到 CHILD key 派生和方向分配逻辑。

主链：

```text
selected ESP proposal
      │
      ▼
keymat_v2->derive_child_keys()
      │
      ▼
根据 initiator/responder 角色
映射 in/out key
      │
      ▼
child_sa->install()
```

这一步非常适合做故障分层：

```text
IKE_AUTH 成功
≠
CHILD key 派生成功
≠
XFRM SA 安装成功
```

---

### 18. crypto factory：strongSwan 为什么适合做算法插件化扩展

strongSwan 的密码对象不是 task 直接 `EVP_get_cipherbyname()` 创建的。

核心文件：

```text
src/libstrongswan/crypto/crypto_factory.c
```

典型工厂接口：

```text
create_crypter()
create_hasher()
create_prf()
create_signer()
create_rng()
create_ke()
```

架构关系：

```text
IKE task / keymat
     │
     ▼
lib->crypto->create_xxx(algorithm)
     │
     ▼
crypto_factory
     │
     ▼
registered plugin/provider
     │
     ▼
crypter_t / hasher_t / prf_t / signer_t / key_exchange_t
```

这意味着：

> 对于能被现有密码接口表达的 SM3/SM4，优先扩展 provider/plugin，而不是改 IKE task。

---

### 19. OpenSSL 插件是一个自然的国密接入候选点

核心目录：

```text
src/libstrongswan/plugins/openssl/
```

重点：

```text
openssl_plugin.c
openssl_crypter.c
openssl_hasher.c
openssl_hmac.c
openssl_ec_private_key.c / public key related files
```

`openssl_plugin.c` 通过 plugin feature 声明“这个插件能提供哪些算法”。

因此 SM4/SM3 接入存在两种工程方案。

#### 19.1 扩展现有 openssl plugin

适合：

- Tongsuo/OpenSSL 能通过标准 EVP API 提供 SM3/SM4；
- 算法行为能完全映射到现有 `crypter_t/prf_t/signer_t`；
- 不需要厂商私有生命周期。

#### 19.2 新建独立 gm/provider plugin

适合：

- 需要 HSM SDK；
- 需要明显不同的 key handle 生命周期；
- 需要独立构建开关和依赖；
- 不希望把 Tongsuo 特性硬塞到通用 OpenSSL 插件。

无论哪一种，都不建议让：

```text
main_mode.c
ike_init.c
child_create.c
```

直接调用 `EVP_*` 或厂商 SDK。

---

### 20. 算法“注册成功”为什么仍远远不够

完整链必须是：

```text
1. keyword 能解析
     ↓
2. proposal 有 internal ID
     ↓
3. wire Transform 编码正确
     ↓
4. 对端选中相同算法
     ↓
5. crypto factory 找到 provider
     ↓
6. provider 构造对象成功
     ↓
7. keymat 使用对象产生正确密钥
     ↓
8. CHILD_SA 正确分配方向
     ↓
9. kernel-netlink 找到内核算法名
     ↓
10. 内核接受 SA
     ↓
11. 实际 ESP 流量成功
```

任何只覆盖前 1-3 层的改动，都不能称为“IPsec 国密功能完成”。

---

### 21. CHILD_SA：用户态密钥交给内核前的最后一层

核心文件：

```text
src/libcharon/sa/child_sa.c
```

重点函数：

```text
install_internal()     （6.0.3 研究快照约 965 行）
```

这里把：

```text
src/dst
SPI
protocol ESP/AH
mode
proposal algorithm
in/out encryption key
in/out integrity key
lifetime
```

整理成 kernel interface 所需参数。

如果方向搞反，会出现非常典型的现象：

```text
IKE/CHILD 都显示 established
但 ESP 单向能通 / 完全不能解密
```

因此国密改造时密钥方向必须作为独立审查项。

---

### 22. kernel-netlink：strongSwan 和 Linux XFRM 的真正边界

核心文件：

```text
src/libcharon/plugins/kernel_netlink/kernel_netlink_ipsec.c
```

关键概念包括：

```text
kernel_algorithm_t
encryption_algs[]
integrity_algs[]
lookup_algorithm()
add_sa()
netlink send/ACK
```

6.0.3 研究快照中：

```text
add_sa()       约 1738 行
send_ack 路径 约 2253 行附近
```

#### 22.1 上游数组的作用

它把 strongSwan 的内部 IKEv2 algorithm ID 映射为 Linux Crypto API/XFRM 认识的名字。

例如上游已有类似：

```text
AES algorithm ID -> cbc(aes)
HMAC-SHA*         -> hmac(sha*)
```

因此 SM4/SM3 数据面要走 Linux XFRM，最终必须存在目标内核可识别的名字，例如逻辑上：

```text
SM4-CBC -> Linux crypto API name
HMAC-SM3 -> Linux crypto API name + truncation
```

具体名称必须以目标内核实际支持情况为准。

#### 22.2 为什么 OpenSSL/Tongsuo 支持 SM4 不能证明 ESP 支持

因为：

```text
Tongsuo/OpenSSL
    └─ 主要给用户态 IKE 密码操作提供算法

Linux XFRM
    └─ 负责 ESP 数据包加密/解密
```

二者是两个 provider 世界。

必须验证：

```bash
cat /proc/crypto
ip xfrm state
ip xfrm policy
```

并查看 Netlink ACK。

---

### 23. IKEv1 和 IKEv2 的国密改造不能只写一份 Transform 映射

二者至少有以下结构差异：

#### IKEv1

```text
DOI / Transform / Attribute 模型
main mode / aggressive mode / quick mode
dedicated keymat_v1
proposal_substructure 中存在 v1 专用转换
```

#### IKEv2

```text
统一 Transform Type/ID 模型
IKE_SA_INIT / IKE_AUTH / CREATE_CHILD_SA
dedicated keymat_v2
支持 additional key exchange 等现代抽象
```

因此一个“国密算法 ID”必须逐版本回答：

```text
它在 IKEv1 wire 上是什么？
它在 IKEv2 wire 上是什么？
它们是否由同一标准定义？
双方是否使用相同约定？
```

不能因为内部 enum 相同，就让两个协议版本自动共享同一个线上数字。

---

### 24. SM2 认证链是独立于 SM4/SM3 的改造面

要实现真正的 SM2 身份认证，需要继续沿 strongSwan credential 子系统研究：

```text
private_key_t
public_key_t
certificate_t
credential_set_t
signature_scheme_t
openssl / pkcs11 / engine provider
IKE authentication task
```

关键问题包括：

1. X.509 是否识别目标 SM2 OID 和签名算法；
2. `public_key_t->verify()` 是否能以正确 SM2 ID/参数验证；
3. `private_key_t->sign()` 是否能走 Tongsuo/HSM；
4. IKEv1 Authentication Method / IKEv2 AUTH 方法的 wire 表达是否符合目标规范；
5. 证书链、Key Usage、身份 ID 的绑定是否符合产品要求。

这部分不能用“openssl plugin 已经支持 EC key”来代替结论。

---

### 25. HSM：应该进入凭据/密码插件，而不是 IKE task

strongSwan 已有的抽象层适合 HSM：

```text
private_key_t
pkcs11 plugin
openssl ENGINE/provider 类入口
credential manager
```

推荐边界：

```text
IKEv1/IKEv2 task
      │ sign/decrypt abstract operation
      ▼
private_key_t
      │
      ▼
PKCS#11 / OpenSSL provider / HSM plugin
      │
      ▼
HSM key handle
```

避免：

```text
main_mode.c -> vendor_hsm_sign()
ike_auth.c  -> vendor_hsm_sign()
```

这样可以保持协议层与设备层解耦。

---

### 26. PQC：6.0.3 的现有抽象为什么值得保留

strongSwan 6.0.x 已经存在：

```text
key_exchange_t
additional key exchange
ML-KEM related provider/support
```

这些说明其 IKEv2 架构能够表达“一个 proposal 中包含 Key Exchange 能力”以及多个共享秘密的组合场景。

这对未来 PQC/混合 IKEv2 是很好的扩展入口。

但必须保持边界：

```text
上游有抽象
≠
当前产品已经支持某个 PQC profile
```

仍需定义：

```text
Transform ID
混合/组合规则
标准版本
对端互通
shared secret 合并/KDF
异常与降级策略
```

---

### 27. 从上游源码反推的国密改造层级

#### 27.1 第一层：低侵入算法扩展

优先修改：

```text
crypter/hasher/prf/signer enum
proposal keywords
crypto plugin feature registration
OpenSSL/Tongsuo provider wrapper
```

目标：让 strongSwan “认识并能创建” SM3/SM4 对象。

#### 27.2 第二层：协议 Transform 映射

```text
proposal_substructure.c
```

目标：让内部算法按目标标准变成正确 IKEv1/IKEv2 线上编号，并能反向解析。

#### 27.3 第三层：认证/证书

```text
credential / private_key / public_key / x509 / auth task
```

目标：完成 SM2 身份认证，而不是只完成对称算法。

#### 27.4 第四层：keymat 参数闭环

```text
keymat_v1.c
keymat_v2.c
```

原则：优先复用抽象；只有目标标准 KDF 与现有 IKE 语义不同才修改算法流程。

#### 27.5 第五层：CHILD/XFRM

```text
child_sa.c
kernel_netlink_ipsec.c
```

目标：正确传递 SM4/SM3 的算法、key length、truncation、SPI、方向密钥，并得到内核 ACK。

#### 27.6 第六层：协议状态机深改

```text
main_mode.c / aggressive_mode.c / quick_mode.c
ike_init.c / ike_auth.c / child_create.c
payload encoder/parser
```

只有当目标标准的报文/密钥交换语义无法被现有抽象表达时才进入这一层。

---

### 28. 哪些修改是危险的“看起来能工作”

#### 28.1 只增加 proposal keyword

结果：配置能加载，但没有 wire ID/provider。

#### 28.2 只在 openssl plugin 注册 SM4

结果：用户态可能能创建 SM4 crypter，但对端不知道 Transform，或者内核 XFRM 不支持。

#### 28.3 用一个 `SM3` enum 同时代替 hash、PRF、integrity

结果：key length、输出长度和协议语义混乱。

#### 28.4 IKEv2 直接发送内部私有 ID

实验对端可能互通，但不能宣称公开标准符合。

#### 28.5 IKE 成功就宣布 IPsec 成功

可能 CHILD_SA 安装失败，或 XFRM 拒绝算法。

#### 28.6 SM4/SM3 完成就宣布“完整国密 IPsec”

还缺 SM2 认证甚至标准要求的 SM2 密钥交换链。

---

### 29. 失败路径应该如何按层定位

#### 配置阶段

```text
unknown proposal keyword
```

优先检查：

```text
proposal_keywords_static.txt
enum 定义
proposal parser
```

#### proposal 协商失败

```text
no proposal chosen / no acceptable proposal
```

优先检查：

```text
wire Transform ID
Transform Type
keysize
对端支持集合
```

#### crypto object 创建失败

优先检查：

```text
plugin 是否加载
feature 是否注册
EVP/Tongsuo provider 是否提供算法
```

#### IKE AUTH 失败

优先检查：

```text
SM2 certificate parsing
signature scheme
public/private key implementation
ID/certificate binding
```

#### CHILD_SA 派生失败

优先检查：

```text
keymat
PRF
key length
nonce/KE inputs
```

#### CHILD_SA install 失败

优先检查：

```text
child_sa direction
kernel algorithm mapping
Netlink message
Linux XFRM support
```

#### IKE/CHILD 显示成功但业务流量失败

优先检查：

```text
ip xfrm state
ip xfrm policy
SPI/方向
ESP packet capture
ICV/key length
内核统计计数器
```

---

### 30. 验证完整国密 IPsec 的证据闭环

#### 30.1 静态源码

必须证明：

```text
keyword -> internal ID
internal ID -> wire ID
internal ID -> provider
provider -> real crypto object
keymat -> key bytes
child_sa -> direction
kernel map -> Linux algorithm name
```

#### 30.2 配置/日志

确认选择的是目标 IKEv1/IKEv2 proposal，而不是 fallback。

#### 30.3 抓包

确认：

```text
IKE SA proposal Transform
Authentication Method / AUTH
KE payload
ESP proposal
SPI
```

#### 30.4 用户态断点

至少确认：

```text
create_crypter(SM4)
create_prf(HMAC-SM3)
create_signer(HMAC-SM3 integrity)
SM2 sign/verify（完成后）
derive_ike_keys()
derive_child_keys()
```

#### 30.5 内核

```bash
cat /proc/crypto
ip -s xfrm state
ip xfrm policy
```

并确认 Netlink `add_sa()` 得到成功 ACK。

#### 30.6 负面测试

至少：

```text
错误 Transform ID
对端不支持 SM4
PRF 不匹配
ICV 长度不匹配
SM2 证书错误
HSM 不可用
内核没有 SM4
内核没有 HMAC-SM3
方向密钥故意交换
```

要求安全失败，不允许静默改用非目标算法后仍报告成功。

---

### 31. 推荐源码导航顺序

### 31.1 strongSwan 6.0.3 函数锚点索引

为了让本文可直接用于源码评审，下面汇总当前 6.0.3 研究快照中的主要函数锚点。**函数名是长期锚点；行号是版本快照锚点。**若使用干净 release tarball、不同编译生成文件或叠加补丁，必须执行下一节的 `rg -n` 重新生成行号。

```text
src/swanctl/commands/load_conns.c
    ~233   load_conn()

src/libcharon/plugins/vici/vici_config.c
    ~643   parse_proposal()
    ~3018  load_conn()

src/libcharon/plugins/vici/vici_control.c
    ~173   initiate()

src/libcharon/control/controller.c
    ~436   initiate_execute()

src/libcharon/sa/ike_sa.c
    ~1577  initiate()

src/libcharon/sa/task_manager.c
    ~89    task_manager_create()

src/libstrongswan/crypto/proposal/proposal.c
    ~699   check_proposal()
    ~854   add_string_algo()

src/libcharon/encoding/payloads/proposal_substructure.c
    ~894   add_to_proposal_v1_ike()
    ~946   add_to_proposal_v1()
    ~1291  set_from_proposal_v1_ike()
    ~1362  set_from_proposal_v1()
    ~1464  encode_transforms_v2()

src/libcharon/sa/ikev1/keymat_v1.c
           derive_ike_keys()
           derive_child_keys()

src/libcharon/sa/ikev2/keymat_v2.c
           derive_ike_keys()
           derive_child_keys()

src/libcharon/sa/ikev2/tasks/child_create.c
    ~770-815  CHILD keys 派生及 initiator/responder 方向分配区域

src/libcharon/sa/child_sa.c
    ~965   install_internal()

src/libcharon/plugins/kernel_netlink/kernel_netlink_ipsec.c
    ~1738  add_sa()
    ~2253  Netlink ACK 处理区域（按函数名重新定位）
```

> 说明：这些行号用于快速进入代码，不用于替代函数级证据。特别是国密实验补丁可能在这些文件前部新增代码，从而使本地工作树行号偏移。正式文档引用应绑定 `472dcd8...` 干净源码并重新记录。


以下命令以 strongSwan 6.0.3 源码根目录为当前目录。

#### 31.2 配置到 proposal

```bash
rg -n 'load_conn\(' src/swanctl src/libcharon/plugins/vici
rg -n 'parse_proposal' src/libcharon/plugins/vici
rg -n 'add_string_algo|check_proposal' src/libstrongswan/crypto/proposal
rg -n 'proposal_keywords' src/libstrongswan/crypto/proposal
```

#### 31.3 发起 IKE

```bash
rg -n 'initiate_execute|METHOD\(ike_sa_t, initiate|task_manager_create' src/libcharon
```

#### 31.4 IKEv1

```bash
rg -n 'main_mode|aggressive_mode|quick_mode' src/libcharon/sa/ikev1
rg -n 'derive_ike_keys|derive_child_keys' src/libcharon/sa/ikev1/keymat_v1.c
rg -n 'add_to_proposal_v1|set_from_proposal_v1' src/libcharon/encoding/payloads/proposal_substructure.c
```

#### 31.5 IKEv2

```bash
rg -n 'TASK_IKE_INIT|TASK_IKE_AUTH|TASK_CHILD_CREATE' src/libcharon/sa/ikev2
rg -n 'derive_ike_keys|derive_child_keys' src/libcharon/sa/ikev2/keymat_v2.c
rg -n 'encode_transforms_v2' src/libcharon/encoding/payloads/proposal_substructure.c
```

#### 31.6 crypto factory/provider

```bash
rg -n 'create_crypter|create_hasher|create_prf|create_signer' src/libstrongswan/crypto
rg -n 'PLUGIN_PROVIDE.*CRYPTER|PLUGIN_PROVIDE.*HASHER|PLUGIN_PROVIDE.*PRF|PLUGIN_PROVIDE.*SIGNER' src/libstrongswan/plugins
rg -n 'EVP_get_cipher|EVP_MAC|HMAC|EVP_MD' src/libstrongswan/plugins/openssl
```

#### 31.7 CHILD_SA 到 XFRM

```bash
rg -n 'derive_child_keys' src/libcharon/sa/ikev1 src/libcharon/sa/ikev2
rg -n 'install_internal' src/libcharon/sa/child_sa.c
rg -n 'encryption_algs|integrity_algs|lookup_algorithm|add_sa\(' src/libcharon/plugins/kernel_netlink/kernel_netlink_ipsec.c
```

以后任何新增算法，都应按照：

```text
配置
→ proposal
→ wire
→ provider
→ keymat
→ child_sa
→ kernel
```

顺序回查一次。

---

### 32. 核心改造点总图

```text
                    strongSwan upstream 6.0.3

swanctl.conf
   │
   │ [改造点 A: 国密 proposal token]
   ▼
vici_config / proposal.c
   │
   │ [改造点 B: 内部 SM2/SM3/SM4 algorithm ID]
   ▼
proposal_t
   │
   │ [改造点 C: IKEv1/IKEv2 wire Transform mapping]
   ▼
IKE task manager / task
   │
   ├──────────────┐
   ▼              ▼
crypto factory    keymat v1/v2
   │              │
   │ [D]          │ [E: key length/KDF semantics]
   ▼              ▼
GM crypto impl   IKE/CHILD keys
   │              │
   └──────┬───────┘
          ▼
       child_sa
          │
          │ [F: algorithm + SPI + direction]
          ▼
  kernel_netlink_ipsec
          │
          │ [G: Linux XFRM algorithm mapping]
          ▼
      Linux XFRM
          │
          ▼
         ESP
```

此外还有两条独立纵向改造链：

```text
SM2 identity/certificate
credential subsystem -> IKE authentication
```

以及在标准要求时：

```text
SM2 key exchange
key_exchange_t -> IKEv1/v2 task/payload -> keymat
```

---

### 33. 结论

从 strongSwan 6.0.3 的上游结构看，GM/T 0022 国密 IPsec 不应该被定义为“给 OpenSSL 插件加 SM3/SM4”。

真正的改造闭环是：

```text
GM/T 1.1 协议画像
→ Main Mode payload 与状态机
→ 双证书/SM2 数字信封
→ proposal internal representation
→ IKEv1 wire Transform
→ crypto factory/provider
→ IKE keymat
→ CHILD keymat
→ child_sa
→ kernel-netlink
→ Linux XFRM
→ 实际 ESP 流量
```

GM/T 0022 已经确定需要 SM2 身份认证、双证书和数字信封，并改变线上消息与 keymat 语义，所以必须进入 IKEv1 状态机和 payload 深改；能够复用的是 strongSwan 的 task 框架、密码接口、凭据框架、CHILD_SA 与 kernel 抽象，不是原封不动的 Main Mode 业务逻辑。

IKEv2 + SM 算法应独立命名、独立定义编号和互通 profile。它可以作为未来技术路线研究，但不能替代 GM/T 0022 合规链。

---

### 参考基线

- strongSwan 6.0.3 release: https://github.com/strongswan/strongswan/releases/tag/6.0.3
- strongSwan 6.0.3 official archive index: https://download.strongswan.org/old/6.x/
- strongSwan source: https://github.com/strongswan/strongswan
- strongSwan proposal keywords: `src/libstrongswan/crypto/proposal/proposal_keywords_static.txt`
- GM/T 0022-2023《IPSec VPN 技术规范》，2024-06-01 实施
- GM/T 0023-2023《IPSec VPN 网关产品规范》，2024-06-01 实施
- GB/T 36968-2018《信息安全技术 IPSec VPN 技术规范》（关联国家标准，项目实际合规基线需单独确定）

> 注：本文中的 strongSwan 行号用于 6.0.3 研究快照快速定位。正式纳入代码评审规范时，应在干净的 `472dcd8...` 工作树执行文末 `rg -n` 命令重新生成行号，函数名和调用关系作为长期锚点。
