---
title: "strongSwan Proposal → Transform → Crypto Factory → Keymat → XFRM 源码精读附录"
description: "从内部算法枚举、线上 Transform 走到密码工厂、keymat 和 XFRM。"
date: "2026-09-29"
updated: "2026-09-29"
category: "crypto"
modules: ["ipsec", "crypto", "provider", "xfrm"]
editorial: "original"
tags: ["strongSwan", "IKEv2", "strongSwan 专题精读"]
kind: "源码精读"
minutes: 60
featured: false
series: "strongSwan 专题精读"
seriesOrder: 4
difficulty: "进阶"
prerequisites: ["按正文的概念解释、源码入口与关联文章补齐前置知识"]
environment: ["原稿整理；本次发布未新增运行实验"]
software: ["strongSwan 6.0.3；源码快照与本地适配边界见正文"]
conclusion: "source"
realVerified: false
verificationActor: "保留原稿的源码分析、资料判断与实验边界；未将文档迁移视为新增实测"
provenance: {"title": "strongSwan Proposal → Transform → Crypto Factory → Keymat → XFRM 源码精读附录", "mode": "原稿收录", "omissions": []}
changes: [{"date": "2026-09-29", "note": "收录技术原稿；调整标题层级、网页图示与站内链接。"}]
repository: "https://github.com/strongswan/strongswan/tree/472dcd8bb50a91f156b725ff56992352b573f7dd"
basis: {"label": "strongSwan 6.0.3 源码", "href": "https://github.com/strongswan/strongswan/tree/472dcd8bb50a91f156b725ff56992352b573f7dd", "boundary": "上游分析、本地适配与实验记录的区别以原文标注为准。"}
---

> 文档类型：源码精读附录 / 国密改造点定位  
> 适用主文档：`strongSwan_IPsec_IKEv1_IKEv2_上游源码研究与国密改造点定位.md`  
> 研究基线：strongSwan 6.0.3，release commit `472dcd8bb50a91f156b725ff56992352b573f7dd`  
> 研究对象：未叠加本项目 SM4/SM3 实验补丁的 strongSwan 上游架构；本项目实验树仅用于说明“一个候选改造如何穿过这些扩展点”，不得反向表述为上游能力或公开标准编号。  
> 核心问题：一个新算法如何从配置字符串进入 `proposal_t`，怎样变成 IKEv1/IKEv2 线上 Transform，如何被 `crypto_factory` 变成真实密码对象，怎样进入 `keymat`，最后如何以算法名、SPI 和密钥的形式交给 Linux XFRM。

> **本文只解释算法链，不等于完整 GM/T 0022 协议链**
> 下文的 `keyword → proposal → Transform → crypto factory → keymat → XFRM` 适合解释“新增一种算法如何贯穿 strongSwan”。GM/T 0022—2023 还改变 IKEv1 Header 版本、Main Mode 载荷、双证书、SM2 数字信封、SKEYID/IV 公式和 Quick Mode HASH 顺序。因而本附录只能作为其中的算法/数据面子链，不能单独证明 GM/T 0022 合规。完整差距见《GM/T 0022—2023 与 strongSwan 6.0.3 上游差距分析》。
>

---

### 0. 证据口径与行号说明

本文采用以下证据标记：

- **【上游源码确认】**：strongSwan 上游源代码结构、函数、对象或控制流可以直接确认；
- **【6.0.3 基线确认】**：已确认 strongSwan 6.0.3 对应 release commit `472dcd8...`；
- **【实验树对照】**：来自当前 6.0.3 + 本地 SM4/SM3 实验修改的值或行号，仅用于说明候选实现，不属于上游原生能力；
- **【改造判断】**：基于上游扩展点得出的改造位置判断；
- **【待标准确认】**：线上编号、认证方法或 KDF 语义必须以目标国密规范和对端约定为准；
- **【运行待验证】**：静态源码存在不等于目标构建、OpenSSL/Tongsuo provider 或 Linux 内核运行时真正支持。

行号具有版本依赖。本文优先使用**文件 + 函数名**作为稳定锚点；凡引用当前实验树的精确行号，会明确标注“实验树”。升级版本或切换到完全干净的 6.0.3 工作树时，应使用文末 `rg` 命令重新定位。

---

## 1. 先建立整条链：一个算法不是“加一个 enum”就结束

### 1.1 一张主链图

```text
swanctl.conf / VICI
        │
        ▼
proposal keyword
proposal_keywords_static.txt
        │
        ▼
proposal.c:add_string_algo()
        │
        │  生成：
        │  (Transform Type, internal Algorithm ID, Key Size)
        ▼
proposal_t
        │
        ├────────────────────────────────────────────┐
        │                                            │
        │ IKEv1                                     │ IKEv2
        ▼                                            ▼
proposal_substructure.c                      proposal_substructure.c
IKEv1 DOI / Transform / Attribute            Transform Type / Transform ID
        │                                            │
        └──────────────────────┬─────────────────────┘
                               ▼
                     对端选择 proposal
                               │
                               ▼
                    task_manager_v1 / v2
                               │
                  ┌────────────┴─────────────┐
                  ▼                          ▼
              keymat_v1                 keymat_v2
                  │                          │
                  └────────────┬─────────────┘
                               ▼
                       lib->crypto->create_*()
                               │
                               ▼
                         crypto_factory
                               │
                               ▼
                     注册过的密码插件/provider
                  crypter / prf / signer / hasher
                               │
                               ▼
                     IKE keys / CHILD keys
                               │
                               ▼
                           child_sa
                               │
                               ▼
                     kernel interface / netlink
                               │
                               ▼
        internal Algorithm ID → Linux Crypto API name
                               │
                               ▼
                       XFRM State / Policy
                               │
                               ▼
                       Linux 内核处理 ESP
```

**【上游源码确认】** strongSwan 的 `proposal_t`、`crypto_factory`、`keymat_v1/v2`、`child_sa_t` 和 kernel interface 是相互分离的抽象层。算法字符串、协议线上编号、密码实现和内核算法名不是同一个对象。

**【改造判断】** 因此一个“SM4/SM3 已接入”的结论，至少要证明以下五层连续成立：

```text
配置能解析
→ 对端能协商相同 Transform
→ crypto factory 能创建真实对象
→ keymat 能按协议长度派生密钥
→ XFRM 能接受并实际使用算法/密钥
```

任何只完成前两层的补丁，都不能称为“IPsec 国密数据面完成”。

---

## 2. 最重要的概念：三个完全不同的“算法标识世界”

这一节是本文的核心。

### 2.1 第一层：strongSwan 内部 Algorithm ID

strongSwan 内部用枚举区分算法角色，例如：

```text
encryption_algorithm_t
integrity_algorithm_t
pseudo_random_function_t
hash_algorithm_t
key_exchange_method_t
```

相关头文件：

```text
src/libstrongswan/crypto/crypters/crypter.h
src/libstrongswan/crypto/signers/signer.h
src/libstrongswan/crypto/prfs/prf.h
src/libstrongswan/crypto/hashers/hasher.h
src/libstrongswan/crypto/key_exchange.h
```

**【上游源码确认】** `proposal_t` 存储的是：

```text
Transform Type
+ internal Algorithm ID
+ Key Size
```

并不是直接保存 IKEv1 报文里的 Phase 1 Attribute 值，也不是保存 Linux 内核字符串。

当前实验树曾使用：

```text
ENCR_SM4_CBC        = 1031
AUTH_HMAC_SM3_128   = 1031
PRF_HMAC_SM3        = 1029
HASH_SM3            = 1032
```

**【实验树对照】** 这些只是当前实验树选择的内部枚举值。它们不是本文要声明的公开标准编号。

尤其要注意：

```text
HASH_SM3
≠ PRF_HMAC_SM3
≠ AUTH_HMAC_SM3_128
```

即使三者底层都使用 SM3，它们的接口语义、key 长度、输出使用方式不同。

---

### 2.2 第二层：IKE 报文上的 Transform / Attribute 编号

这是“协议线上值”。

IKEv1 与 IKEv2 的编码模型不同。

#### IKEv1

IKEv1 不是简单地把 strongSwan 内部 ID 原样写到包里。它存在独立的 DOI / Transform / Attribute 映射。

典型例子：Phase 1 Encryption Algorithm、Hash Algorithm、Group 等是 Transform Attribute；ESP Encryption 则还涉及 ESP Transform ID。

#### IKEv2

IKEv2 使用更统一的：

```text
Transform Type
+ Transform ID
+ optional Attributes
```

但“结构统一”并不意味着 strongSwan 任意内部私有 ID 自动获得公开 IKEv2 标准含义。

**【改造判断】** 内部 ID 与线上 ID 必须分别定义和审查。

---

### 2.3 第三层：Linux XFRM / Linux Crypto API 算法名

到了 Linux 内核，charon 不再发送 IKE Transform 数字给 XFRM，而需要告诉内核具体的 Linux Crypto API 算法名称。

上游核心文件：

```text
src/libcharon/plugins/kernel_netlink/kernel_netlink_ipsec.c
```

其中定义：

```c
struct kernel_algorithm_t {
    int ikev2;
    const char *name;
};
```

并维护类似：

```text
encryption_algs[]
integrity_algs[]
lookup_algorithm()
```

**【上游源码确认】** 上游已有 AES、SHA 等 internal algorithm → Linux Crypto API name 映射，例如 AES-CBC 对应 AES/cbc 类内核名称，HMAC-SHA2 对应 `hmac(sha256)` 等。

**【改造判断】** SM4/SM3 如果走 Linux XFRM，也必须新增/取得相应内核算法名，例如实验树使用：

```text
ENCR_SM4_CBC       → cbc(sm4)
AUTH_HMAC_SM3_128  → hmac(sm3)
```

**【实验树对照】【运行待验证】** 这两个字符串只是 strongSwan → Linux Crypto API 的目标映射。是否真的可用取决于目标内核是否注册相同名称的算法。

---

### 2.4 三层映射一览

| 用途 | strongSwan 内部表示 | IKEv1 线上表示 | IKEv2 线上表示 | Linux XFRM 表示 |
|---|---|---|---|---|
| IKE/ESP 加密 | `ENCR_SM4_CBC` / SM4-GCM 内部 ID | GM/T 1.1：Phase 1 SM4=`129`；ESP SM4-CBC=`127`、SM4-GCM=`130`。实验树旧值不是标准值 | 需另一份 IKEv2 profile/Transform ID；不能复制 IKEv1 值 | `cbc(sm4)` / 目标内核认可的 AEAD 名称 |
| IKE PRF | `PRF_HMAC_SM3` | GM/T 1.1 的 Hash Algorithm=`20` 进入内部后需形成 HMAC-SM3 PRF 语义 | PRF Transform ID 需独立 profile | 不下发 XFRM |
| IKE/ESP integrity | `AUTH_HMAC_SM3_128`（具体截断长度须按标准对象区分） | GM/T 1.1：第一阶段 Hash=`20`；Phase 2 HMAC-SM3=`20` | Integrity Transform ID 需独立 profile | `hmac(sm3)` + 规定的 truncation |
| 无密钥摘要 | `HASH_SM3` | 一般不作为独立 ESP Transform | 一般不作为独立 ESP Transform | 不直接下发 XFRM |

> 这张表只表达“层次关系”。其中实验编号是本地 PoC/实验树对照，不是标准赋值。

---

## 3. Proposal 层：算法从配置字符串变成内部对象

### 3.1 配置入口

源码：

```text
src/libstrongswan/crypto/proposal/proposal_keywords_static.txt
src/libstrongswan/crypto/proposal/proposal.c
```

函数锚点：

```text
proposal.c:add_string_algo()
proposal.c:check_proposal()
proposal_t::add_algorithm()
proposal_t::get_algorithm()
```

6.0.3 当前研究快照中的定位：

```text
add_string_algo() 约 854 行
check_proposal()  约 699 行
```

**【上游源码确认】** `add_string_algo()` 的关键语义是：

```text
配置字符串 token
    ↓
lib->proposal->get_token(...)
    ↓
proposal_token_t
    ├ type
    ├ algorithm
    └ keysize
    ↓
proposal->add_algorithm(type, algorithm, keysize)
```

也就是说，如果增加：

```text
sm4cbc
prfsm3
sm3
```

真正需要进入 `proposal_t` 的不是字符串，而是：

```text
sm4cbc → (ENCRYPTION_ALGORITHM, ENCR_SM4_CBC, keysize)
prfsm3 → (PSEUDO_RANDOM_FUNCTION, PRF_HMAC_SM3, 0)
sm3    → (INTEGRITY_ALGORITHM, AUTH_HMAC_SM3_128, 0)
```

**【改造判断】** proposal keyword 文件是新增国密算法的第一个入口，但它只解决“配置能认识算法”。

---

### 3.2 `check_proposal()` 为什么必须一起看

`check_proposal()` 会判断 proposal 是否具备某协议所需要的 Transform 类型。

上游逻辑中，一个重要行为是：

```text
IKE proposal 如果没有显式 PRF
    ↓
尝试从 integrity algorithm 映射到对应 PRF
```

因此上游已经存在类似：

```text
integrity algorithm → PRF
```

的映射机制。

**【上游源码确认】** 对 IKE proposal 来说，PRF 是强语义，不是“随便选一个 digest”。

**【改造判断】** 如果新增 `AUTH_HMAC_SM3_128`，且希望允许 IKEv1/配置语法按照 integrity 自动补 PRF，就需要定义：

```text
AUTH_HMAC_SM3_128 → PRF_HMAC_SM3
```

但不能定义：

```text
HASH_SM3 → PRF_HMAC_SM3
```

因为 `HASH_SM3` 没有 key，接口语义不匹配。

---

## 4. IKEv1：Proposal → 线上 Transform/Attribute

### 4.1 为什么 IKEv1 是最容易映射错的一层

IKEv1 内部存在两个不同的 proposal 场景：

```text
Phase 1：建立 IKE SA
    Main Mode / Aggressive Mode

Phase 2：建立 ESP/AH SA
    Quick Mode
```

两者在线上使用的编号空间不同。

所以不能只问：

> “SM4 的 IKEv1 ID 是多少？”

而要问：

```text
Phase 1 Encryption Attribute 是多少？
Phase 1 Hash Attribute 是多少？
ESP Transform ID 是多少？
ESP Authentication Attribute 是多少？
Authentication Method 是否还需要 SM2 专门编号？
KE/Group 是否改变？
```

---

### 4.2 核心文件：`proposal_substructure.c`

源码：

```text
src/libcharon/encoding/payloads/proposal_substructure.c
```

6.0.3 研究快照函数锚点：

```text
add_to_proposal_v1_ike()       约 894
add_to_proposal_v1()           约 946
set_from_proposal_v1_ike()     约 1291
set_from_proposal_v1()         约 1362
```

当前上游实现中还能看到一组非常关键的映射函数/数组概念：

```text
map_encr[]
map_integ[]
map_prf[]
map_esp[]
map_ah[]
map_auth[]

ikev2_from_ikev1()
ikev1_from_ikev2()
get_alg_from_ikev1()
get_ikev1_from_alg()
get_alg_from_ikev1_transid()
get_ikev1_transid_from_alg()
```

**【上游源码确认】** 这组代码说明 strongSwan 把内部统一算法标识与 IKEv1 特有编号空间显式隔离。

---

### 4.3 IKEv1 接收方向：wire → internal proposal

#### Phase 1

`add_to_proposal_v1_ike()` 解析 IKEv1 Transform Attributes。

关键逻辑可以概括为：

```text
TATTR_PH1_ENCRYPTION_ALGORITHM
    ↓
get_alg_from_ikev1(ENCRYPTION_ALGORITHM, wire_value)
    ↓
proposal_t::add_algorithm(ENCRYPTION_ALGORITHM, internal_id, keylen)
```

对于 Hash Algorithm，上游行为尤其重要：

```text
TATTR_PH1_HASH_ALGORITHM
    ├→ INTEGRITY_ALGORITHM
    └→ PSEUDO_RANDOM_FUNCTION
```

即同一个 IKEv1 Phase 1 Hash Attribute 在 strongSwan 内部会分别形成 integrity 和 PRF 角色。

**【上游源码确认】** 这是理解 IKEv1 国密 SM3 的关键：线上可能只有一个 Hash Attribute，但进入内部后，不能只生成 `HASH_SM3`，而应进入 HMAC/integrity 与 PRF 两种语义。

#### Phase 2 / ESP

`add_to_proposal_v1()` 解析 ESP/AH Transform：

```text
ESP Transform ID
    ↓
get_alg_from_ikev1_transid(ENCRYPTION_ALGORITHM, transform_id)
    ↓
ENCRYPTION_ALGORITHM / internal ID

TATTR_PH2_AUTH_ALGORITHM
    ↓
get_alg_from_ikev1_auth(value)
    ↓
INTEGRITY_ALGORITHM / internal ID
```

**【上游源码确认】** ESP Encryption Transform ID 与 Phase 1 Encryption Attribute 是两套不同映射入口。

---

### 4.4 IKEv1 发送方向：internal proposal → wire

反向构造 Transform 时，strongSwan 会从内部算法取出对应 IKEv1 值。

逻辑上是：

```text
proposal_t internal algorithm
       ↓
get_ikev1_from_alg() / get_ikev1_transid_from_alg()
       ↓
IKEv1 Transform Attribute / ESP Transform ID
```

**【改造判断】** 新增 SM4/SM3 时，接收和发送两个方向都必须补全。只改发送端，会出现：

```text
本端能发
但收到对端相同 Transform 后解析成 UNKNOWN
```

只改接收端则会出现相反问题。

---

### 4.5 当前实验树如何穿过 IKEv1 映射

当前实验修改中使用：

```text
IKEv1 Phase1 Encryption  65006 → ENCR_SM4_CBC
IKEv1 Phase1 Hash/PRF    65001 → AUTH/PRF-HMAC-SM3
ESP Encryption              254 → ENCR_SM4_CBC
ESP Authentication        65001 → AUTH_HMAC_SM3_128
```

相关实验树位置：

```text
proposal_substructure.c
    add_to_proposal_v1_ike()    ~894
    add_to_proposal_v1()        ~946
    set_from_proposal_v1_ike()  ~1291
    set_from_proposal_v1()      ~1362
```

**【实验树对照】** 这些编号只说明“本地双方可以约定这样解释”。

**【标准核对】** 上述 `65006 / 65001 / 254` 只是实验私有值，不能作为 GM/T 0022 编号。GM/T 0022 的目标值应按具体字段分别核对，例如第一阶段 SM4=`129`、SM3=`20`，ESP SM4-CBC=`127`、SM4-GCM=`130`、HMAC-SM3=`20`；还必须在 1.1 profile 中处理认证方法值 `10` 与上游 ECDSA-384 的语义冲突。

---

## 5. IKEv1：Proposal → crypto factory → IKE keymat

### 5.1 `keymat_v1.c` 是“协商结果真正进入密码对象”的地方

源码：

```text
src/libcharon/sa/ikev1/keymat_v1.c
```

核心接口：

```text
derive_ike_keys()
derive_child_keys()
create_hasher()
```

**【上游源码确认】** `derive_ike_keys()` 会从 `proposal_t` 中读取 PRF；如果没有显式 PRF，则尝试把 integrity algorithm 转为对应 PRF，然后调用：

```c
lib->crypto->create_prf(lib->crypto, alg)
```

因此 proposal 里存在 `PRF_HMAC_SM3` 还不够，crypto factory 中必须有一个 provider 真正注册它。

---

### 5.2 IKEv1 PRF 对象创建失败意味着什么

主链：

```text
proposal_t
    ↓ get PSEUDO_RANDOM_FUNCTION
PRF_HMAC_SM3
    ↓
lib->crypto->create_prf()
    ↓
crypto_factory
    ↓
遍历已注册 PRF constructor
    ↓
openssl_hmac / gm plugin / other provider
```

如果没有 provider：

```text
create_prf() → NULL
```

`derive_ike_keys()` 失败。

**【上游源码确认】** 所以“proposal 协商成功”与“IKE 密钥可派生”是两个不同阶段。

---

### 5.3 IKEv1 加密对象也通过 factory

`keymat_v1.c` 的 `create_aead()` 包装 IKEv1 加密/完整性对象，先从 proposal 获取：

```text
ENCRYPTION_ALGORITHM
```

再通过统一 crypto abstraction 创建 crypter。

**【改造判断】** SM4-CBC 如果符合现有 `crypter_t` 语义，应在密码插件中实现，而不是在 `keymat_v1.c` 内直接写 `EVP_get_cipherbyname("SM4-CBC")`。

---

### 5.4 IKEv1 SKEYID 生命周期

`derive_ike_keys()` 的协议输出包括：

```text
SKEYID
SKEYID_d
SKEYID_a
SKEYID_e
```

其中 PRF 对象参与 SKEYID 系列派生；`SKEYID_e` 最终用于 IKE SA 的加密密钥材料。

**【上游源码确认】** `keymat_v1.c` 已经把 PRF 接口与具体密码 provider 解耦，因此 HMAC-SM3 原语应通过 `prf_t` 接入。

**【标准差距】** GM/T 0022 已经修改了 SKEYID 输入、拼接次序和初始 IV：上游依赖 DH 共享秘密 `g^xy`，GM/T 路线使用 `HASH(Ni | Nr)`、Cookie 以及数字信封产生的 `Sk_i/Sk_r`。因此必须为 GM/T profile 深入修改 `derive_ike_keys()` 的数据流和公式；不能把“复用 PRF 抽象”误写成“复用上游 KDF”。

---

## 6. IKEv1：Quick Mode → CHILD key → XFRM

### 6.1 Quick Mode 是 ESP 密钥进入数据面的桥

源码：

```text
src/libcharon/sa/ikev1/tasks/quick_mode.c
```

关键对象：

```text
proposal_t *proposal
keymat_v1_t *keymat
child_sa_t *child_sa
SPI_i / SPI_r
nonce_i / nonce_r
optional DH/PFS
```

主链：

```text
selected ESP proposal
      ↓
keymat_v1->derive_child_keys(...)
      ↓
encr_i / integ_i / encr_r / integ_r
      ↓
child_sa->install(...)
```

**【上游源码确认】** Quick Mode 不自己实现 SM4/HMAC-SM3，而是把选中的 proposal 和输入交给 keymat，再把方向密钥交给 child_sa。

---

### 6.2 `derive_child_keys()` 怎样读取算法和长度

源码：

```text
src/libcharon/sa/ikev1/keymat_v1.c:derive_child_keys()
```

它首先从 proposal 中读取：

```text
ENCRYPTION_ALGORITHM → enc_alg / enc_size
INTEGRITY_ALGORITHM  → int_alg / int_size
```

若 proposal 未显式给 key size，会通过 `keymat_get_keylen_encr()` / `keymat_get_keylen_integ()` 等机制取得算法所需长度。

最后输出：

```text
encr_i
integ_i
encr_r
integ_r
```

**【改造判断】** SM4/SM3 接入不仅要提供 algorithm ID，还要保证：

```text
SM4 key size
HMAC-SM3 key size
ICV truncation
```

分别在正确抽象中有定义。

特别是：

```text
HMAC key length ≠ ICV length
```

当前实验设计为：

```text
AUTH_HMAC_SM3_128
HMAC key = 256 bit
ICV      = 128 bit
```

**【实验树对照】** 这两个长度不能因为名称里有 `_128` 就都设成 128 bit。

---

## 7. IKEv2：Proposal → Transform

### 7.1 IKEv2 的线上模型更接近 strongSwan 内部模型

IKEv2 SA payload 使用：

```text
Transform Type
Transform ID
Attributes
```

因此 strongSwan 内部：

```text
ENCRYPTION_ALGORITHM
PSEUDO_RANDOM_FUNCTION
INTEGRITY_ALGORITHM
KEY_EXCHANGE_METHOD
```

与 IKEv2 的 Transform Type 结构天然较接近。

但仍要强调：

> “结构接近”不等于“内部私有数字可以自动成为标准 Transform ID”。

---

### 7.2 源码入口

仍然是：

```text
src/libcharon/encoding/payloads/proposal_substructure.c
```

当前 6.0.3 实验研究中关注：

```text
encode_transforms_v2() 约 1464 行
```

**【上游源码确认】** IKEv2 transform 的编码过程会枚举 `proposal_t` 中的 transform，并构造 IKEv2 transform substructure。

**【实验树对照】** 当前实验路径曾直接把本地内部私有 ID 写到 IKEv2 Transform ID。

这对于“双方都运行同一套私有补丁”的 PoC 可以形成互通约定，但：

**【待标准确认】** 它不能自动成为公开国密 IKEv2 Transform 编号。

---

### 7.3 IKEv2 解析方向同样必须闭环

接收对端 IKEv2 SA payload 后，Transform Type/ID 最终必须恢复成：

```text
proposal_t
    (type, internal ID, key size)
```

所以正式实现要证明：

```text
本地配置 internal ID
  ↕
IKEv2 wire Transform ID
```

双向一致。

如果只让 encoder 发出私有值，却没有 parser/algorithm registry 能正确识别，就不可能完成真正协商。

---

## 8. IKEv2：keymat_v2 怎样使用 PRF、SM4 与 integrity

### 8.1 `derive_ike_keys()` 从 proposal 读取真正协商结果

源码：

```text
src/libcharon/sa/ikev2/keymat_v2.c
```

接口：

```text
derive_ike_keys()
derive_child_keys()
```

`derive_ike_keys()` 首先读取：

```text
PSEUDO_RANDOM_FUNCTION
ENCRYPTION_ALGORITHM
INTEGRITY_ALGORITHM（非 AEAD）
```

然后通过：

```c
lib->crypto->create_prf(...)
```

取得真实 PRF 对象。

**【上游源码确认】** 如果 factory 返回 `NULL`，会输出“不支持所选 PRF”一类错误并终止派生。

这说明：

```text
Transform negotiated
≠ provider object exists
```

---

### 8.2 IKEv2 IKE key block 的真实切分

`keymat_v2.c` 中的核心逻辑是：

```text
KEYMAT = prf+(SKEYSEED, Ni | Nr | SPIi | SPIr)
```

随后切分：

```text
SK_d
SK_ai
SK_ar
SK_ei
SK_er
SK_pi
SK_pr
```

**【上游源码确认】** 代码会根据实际 signer/crypter 对象的 `get_key_size()` 决定 `SK_ai/ar` 与 `SK_ei/er` 的长度，然后按顺序从 keymat 中切出。

因此对于国密算法：

```text
PRF_HMAC_SM3 output/key size
AUTH_HMAC_SM3_128 key size
SM4-CBC key size
```

都会实际影响 KEYMAT 总长度和切分边界。

如果这些长度定义错了，问题不是“日志显示算法名字不对”，而是双方派生出来的密钥字节边界直接不同。

---

### 8.3 IKEv2 `derive_child_keys()`

输入：

```text
selected CHILD/ESP proposal
SK_d
Nonce_i / Nonce_r
optional KE / additional KE secrets
```

输出：

```text
encr_i
integ_i
encr_r
integ_r
```

上游代码会：

1. 从 proposal 读取 `ENCRYPTION_ALGORITHM`；
2. 确定加密 key size；
3. 读取 `INTEGRITY_ALGORITHM`；
4. 确定 integrity key size；
5. 构造 `prf+` KDF；
6. 按 `enc_i | integ_i | enc_r | integ_r` 切分。

**【上游源码确认】** keymat 不关心 Linux 内核名 `cbc(sm4)`；它只处理 strongSwan internal algorithm 和密钥长度。

这是不同层边界的一个典型例子。

---

## 9. crypto_factory：算法 ID 如何变成真实密码对象

### 9.1 factory 本身不知道“SM4 是什么”

核心文件：

```text
src/libstrongswan/crypto/crypto_factory.c
```

重点接口：

```text
create_crypter()
create_signer()
create_hasher()
create_prf()
create_ke()
```

内部注册项包含：

```text
algorithm ID
plugin_name
constructor function pointer
```

**【上游源码确认】** 以 `create_crypter()` 为例，factory 的核心行为是：

```text
遍历 registered crypters
    ↓
entry->algo == requested algo ?
    ↓ yes
调用 entry->create_crypter(algo, key_size)
    ↓
第一个成功返回对象的 provider 胜出
```

`create_prf()` 等接口采用相同的注册/构造思想。

所以 factory 不需要写：

```c
if (algo == ENCR_SM4_CBC) EVP_get_cipherbyname(...)
```

正确层次是：

```text
crypto_factory
    ↓ algorithm ID
plugin constructor
    ↓
OpenSSL/Tongsuo/HSM-specific implementation
```

---

### 9.2 国密算法的自然改造位置

如果使用 Tongsuo/OpenSSL EVP：

```text
src/libstrongswan/plugins/openssl/openssl_plugin.c
src/libstrongswan/plugins/openssl/openssl_crypter.c
src/libstrongswan/plugins/openssl/openssl_hmac.c
src/libstrongswan/plugins/openssl/openssl_hasher.c
```

当前实验树曾在 `openssl_plugin.c` 注册：

```text
CRYPTER  ENCR_SM4_CBC
HASHER   HASH_SM3
PRF      PRF_HMAC_SM3
SIGNER   AUTH_HMAC_SM3_128
```

并由 `openssl_crypter.c` 通过 EVP 名称取得 SM4-CBC。

**【实验树对照】** 这是一个符合 strongSwan 上游架构的低侵入接入方式。

**【改造判断】** 正式工程可选择：

```text
扩展 openssl plugin
```

或：

```text
建立独立 gm/tongsuo/hsm plugin
```

但都不应让 `keymat_v1.c`、`keymat_v2.c`、`quick_mode.c`、`child_create.c` 直接依赖厂商 SDK。

---

### 9.3 注册成功也不代表运行成功

可能出现：

```text
openssl_plugin.c 声明支持 ENCR_SM4_CBC
        ↓
crypto_factory 找到 constructor
        ↓
openssl_crypter_create()
        ↓
运行时 EVP/provider 找不到 SM4-CBC
        ↓
返回 NULL
```

因此需要分别验证：

```text
plugin feature registered
constructor invoked
EVP/provider algorithm fetched
object returned non-NULL
```

**【运行待验证】** 构建时链接了 OpenSSL/Tongsuo 与运行时 provider 是否实际提供算法，是独立问题。

---

## 10. IKEv1 与 IKEv2 汇合：CHILD_SA 的方向密钥

无论 IKEv1 Quick Mode 还是 IKEv2 CHILD_CREATE，最终都会得到类似：

```text
encr_i
integ_i
encr_r
integ_r
```

但这四块不是简单地“按本机 in/out 排列”。

其中：

```text
_i = initiator 使用方向
_r = responder 使用方向
```

之后 task 根据当前本端角色，将它们映射为本端 inbound/outbound。

---

### 10.1 IKEv2 `child_create.c` 的方向分配

源码：

```text
src/libcharon/sa/ikev2/tasks/child_create.c
```

6.0.3 当前研究快照关注约：

```text
770-815 行附近
```

核心语义：

```text
if local is initiator:
    inbound  ← encr_r / integ_r
    outbound ← encr_i / integ_i
else:
    inbound  ← encr_i / integ_i
    outbound ← encr_r / integ_r
```

**【上游源码确认】** 方向选择发生在 CHILD task，而不是 kernel-netlink 自己猜方向。

这意味着如果方向密钥装反，典型现象可能是：

```text
IKE SA established
CHILD SA 似乎也创建
但 ESP 单向失败 / 解密失败 / replay 或 integrity error
```

---

## 11. `child_sa.c`：把 proposal + SPI + 密钥整理成 kernel SA

核心文件：

```text
src/libcharon/sa/child_sa.c
```

关键函数：

```text
install_internal()
```

6.0.3 当前研究快照约：

```text
965 行附近
```

该函数是用户态进入 kernel interface 前的关键对象汇总点。

它要处理：

```text
source / destination
SPI
ESP/AH protocol
mode
proposal encryption algorithm
proposal integrity algorithm
inbound/outbound key
lifetime
mark / if_id / reqid 等
```

并构造类似：

```text
kernel_ipsec_sa_id_t
kernel_ipsec_add_sa_t
```

再调用 kernel interface。

**【上游源码确认】** 到这里仍然使用 strongSwan internal Algorithm ID；它还没有变成 Linux Crypto API 名字。

---

## 12. kernel-netlink：内部 Algorithm ID 最终在哪里变成 `cbc(sm4)` / `hmac(sm3)`

### 12.1 核心文件

```text
src/libcharon/plugins/kernel_netlink/kernel_netlink_ipsec.c
```

重点对象：

```text
kernel_algorithm_t
encryption_algs[]
integrity_algs[]
lookup_algorithm()
add_sa()
```

当前上游代码明确把 internal algorithm ID 映射为 Linux Crypto API 字符串，再用于构造 Netlink XFRM attributes。

**【上游源码确认】** 这个设计说明 XFRM 名称是独立于 IKE wire ID 的第四方接口契约。

---

### 12.2 加密映射

上游已有类似：

```text
ENCR_AES_CBC → aes / cbc(aes) 类 Linux Crypto API 名称
ENCR_AES_CTR → rfc3686(ctr(aes))
...
```

国密实验树加入：

```text
ENCR_SM4_CBC → cbc(sm4)
```

**【实验树对照】** `cbc(sm4)` 不是 IKE Transform 名称，它是 Linux Crypto API / XFRM 侧的算法标识。

---

### 12.3 integrity 映射

上游已有：

```text
AUTH_HMAC_SHA2_256_128 → hmac(sha256)
...
```

国密实验树加入：

```text
AUTH_HMAC_SM3_128 → hmac(sm3)
```

同时 Netlink 的 integrity attribute 要区分：

```text
alg_key_len
alg_trunc_len
```

当前实验目标：

```text
HMAC-SM3 key length = 256 bit
ICV truncation      = 128 bit
```

**【实验树对照】** 这再次证明：`AUTH_HMAC_SM3_128` 名称中的 `128` 描述 ICV 截断，不代表 HMAC key 只有 128 bit。

---

### 12.4 `add_sa()` 与内核 ACK

当前实验树研究锚点：

```text
kernel_netlink_ipsec.c:add_sa()      ~1738
Netlink ACK / send_ack path          ~2253
```

主链：

```text
child_sa::install_internal()
      ↓
charon kernel interface
      ↓
kernel_netlink:add_sa()
      ↓
lookup_algorithm(internal ID)
      ↓
cbc(sm4) / hmac(sm3)
      ↓
构造 XFRM_MSG_NEWSA / UPDSA
      ↓
Netlink send
      ↓
Linux kernel ACK
```

**【改造判断】** 真正判断“ESP 国密数据面建立”的最低证据不是 proposal 日志，而应至少包含：

```text
Netlink SA install success
+ ip xfrm state 中出现目标算法/密钥长度
+ ip xfrm policy 正确
+ 实际 ESP 流量双向通过
```

---

## 13. IKEv1 与 IKEv2 两条完整链并排看

### 13.1 IKEv1

```text
swanctl/VICI proposal string
        ↓
proposal.c
        ↓
proposal_t internal IDs
        ↓
proposal_substructure.c
        ↓
IKEv1 Phase1 Transform Attributes
        ↓
main_mode/aggressive_mode
        ↓
keymat_v1::derive_ike_keys()
        ↓
crypto_factory → PRF/crypter/hasher
        ↓
SKEYID_d/a/e
        ↓
IKE SA established
        ↓
Quick Mode ESP proposal
        ↓
IKEv1 ESP Transform/Attributes
        ↓
keymat_v1::derive_child_keys()
        ↓
encr_i/integ_i/encr_r/integ_r
        ↓
quick_mode → child_sa::install()
        ↓
child_sa::install_internal()
        ↓
kernel_netlink::add_sa()
        ↓
internal ID → Linux algorithm name
        ↓
Linux XFRM
        ↓
ESP
```

### 13.2 IKEv2

```text
swanctl/VICI proposal string
        ↓
proposal.c
        ↓
proposal_t internal IDs
        ↓
proposal_substructure.c
        ↓
IKEv2 Transform Type/ID
        ↓
ike_init / IKE_SA_INIT
        ↓
keymat_v2::derive_ike_keys()
        ↓
crypto_factory
        ↓
SKEYSEED
        ↓
SK_d / SK_ai/ar / SK_ei/er / SK_pi/pr
        ↓
IKE_AUTH / initial CHILD or CREATE_CHILD_SA
        ↓
keymat_v2::derive_child_keys()
        ↓
encr_i/integ_i/encr_r/integ_r
        ↓
child_create → child_sa::install()
        ↓
child_sa::install_internal()
        ↓
kernel_netlink::add_sa()
        ↓
internal ID → Linux algorithm name
        ↓
Linux XFRM
        ↓
ESP
```

---

## 14. 一张真正用于 Review 的“映射闭环矩阵”

下面的矩阵比“修改了哪些文件”更适合代码审查。

| 层 | SM4/SM3 必须回答的问题 | 典型源码锚点 | 若缺失会怎样 |
|---|---|---|---|
| 配置 token | `sm4cbc/sm3/prfsm3` 能否解析？ | `proposal_keywords_static.txt`, `proposal.c:add_string_algo()` | unknown algorithm / load-conn 失败 |
| internal ID | 是否按 encryption / integrity / PRF / hash 分角色？ | `crypter.h`, `signer.h`, `prf.h`, `hasher.h` | 语义混用、长度错误 |
| IKEv1 wire | Phase1 与 ESP 是否分别映射？ | `proposal_substructure.c` v1 mapping | no proposal chosen / 对端无法解析 |
| IKEv2 wire | Transform Type/ID 是否为双方认可值？ | `proposal_substructure.c` v2 encoder/parser | 私有值只能同补丁互通 |
| crypto provider | factory 能否创建真实对象？ | `crypto_factory.c`, `openssl_plugin.c` | proposal 成功但 keymat 失败 |
| IKE keymat | PRF/加密对象长度和输出是否正确？ | `keymat_v1.c`, `keymat_v2.c` | IKE integrity/decrypt 失败 |
| CHILD keymat | ESP 加密/完整性 key size 是否正确？ | `derive_child_keys()` | 双方 ESP key 不一致 |
| 方向分配 | `_i/_r` 是否正确变成本机 in/out？ | `quick_mode.c`, `child_create.c` | 单向通或完整性失败 |
| kernel mapping | internal ID 是否有 Linux Crypto API 名？ | `kernel_netlink_ipsec.c` | SA install 失败 |
| kernel support | 目标内核是否真的有算法？ | `/proc/crypto`, Netlink ACK | `ENOENT/EINVAL` 类安装失败 |
| 数据面 | XFRM 是否实际处理双向 ESP？ | `ip xfrm state/policy`, 抓包 | IKE 成功但业务不通 |

---

## 15. 对“当前实验树”应该怎样表述，才不会和上游研究混在一起

建议文档统一使用以下措辞：

#### 可以写

```text
基于 strongSwan 6.0.3 上游抽象，SM4/SM3 的候选改造路径为：
proposal token/internal ID
→ IKEv1/IKEv2 Transform 映射
→ crypto plugin/provider
→ keymat
→ CHILD_SA
→ kernel-netlink/XFRM。

当前实验树已验证性地在这些层增加了 SM4/SM3 入口，其中部分 wire ID 为私有实验约定。
```

#### 不应该写

```text
strongSwan 6.0.3 原生支持 SM4/SM3 国密 IPsec。
```

也不应该写：

```text
65006 / 65001 / 254 是 strongSwan 或公开国密标准的固定编号。
```

这些值已经确认只是实验私有编号，不得再作为 GM/T 0022 候选编号使用。

---

## 16. 失败路径：从现象倒推应该看哪一层

### 16.1 配置时报 unknown algorithm

优先看：

```text
proposal_keywords_static.txt
internal enum
proposal token registry
```

不要先看 XFRM。

---

### 16.2 能加载配置，但协商 `no proposal chosen`

优先看：

```text
internal type 是否正确
IKEv1/IKEv2 wire ID
key size attribute
对端 Transform 语义
```

这时 crypto provider 甚至可能还没被真正使用。

---

### 16.3 proposal 已选中，但 IKE 密钥派生失败

优先看：

```text
crypto_factory create_prf/create_crypter/create_signer
plugin 是否加载
OpenSSL/Tongsuo provider 是否真正提供算法
key size 是否被 factory constructor 接受
```

---

### 16.4 IKE SA 成功，但 CHILD_SA 失败

优先看：

```text
derive_child_keys()
ESP proposal
key length
方向密钥
child_sa install
kernel-netlink ACK
```

---

### 16.5 CHILD_SA 日志建立，但业务不通

优先看：

```text
ip xfrm state
ip xfrm policy
in/out SPI
src/dst
mark/if_id
cbc(sm4) / hmac(sm3) 是否真实存在
ESP 抓包
反向 SA 是否安装
```

不要用“IKE 成功”作为数据面证明。

---

## 17. 针对国密改造的负面测试建议

仅有正向互通不足以证明映射正确。

### 17.1 proposal 层

- 删除 `sm4cbc` token，确认配置明确失败；
- 故意把 `sm3` 错映射为 PRF type，确认 proposal 校验/后续失败；
- IKEv1 对端使用不同私有 Transform ID，确认不能误选；
- IKEv2 发未知 private Transform，确认安全拒绝而不是 fallback。

### 17.2 crypto factory 层

- 禁用提供 SM4 的 provider，确认 `create_crypter()` 返回失败；
- 禁用 SM3 PRF provider，确认 IKE keymat 无法继续；
- 让 hasher 存在但 PRF 不存在，确认不能拿 `HASH_SM3` 静默替代 HMAC-SM3 PRF。

### 17.3 keymat 层

- 故意配置错误 SM4 key size，确认失败；
- 故意把 HMAC-SM3 integrity key size 当作 128 bit，验证双方不应“看起来成功”；
- 检查 initiator/responder 四块 CHILD key 的方向是否对称对应。

### 17.4 XFRM 层

- 目标内核移除/禁用 `cbc(sm4)`，确认 SA install 失败；
- 移除 `hmac(sm3)`，确认内核拒绝；
- 故意错误设置 truncation，检查 Netlink 或 ESP integrity 失败；
- 只安装单方向 SA，验证业务现象与日志能正确分层定位。

---

## 18. 源码导航命令：按“写入 → 编码 → 创建 → 派生 → 安装”顺序阅读

以下均为只读命令。

### 18.1 Proposal / internal ID

```bash
rg -n 'add_string_algo|check_proposal|add_algorithm|get_algorithm' \
  src/libstrongswan/crypto/proposal

rg -n 'ENCR_|AUTH_|PRF_|HASH_' \
  src/libstrongswan/crypto/{crypters,signers,prfs,hashers}
```

如果研究本地 SM4/SM3 实验树：

```bash
rg -n 'SM4|SM3|sm4cbc|prfsm3' src
```

---

### 18.2 IKEv1 Transform

```bash
rg -n \
'add_to_proposal_v1_ike|add_to_proposal_v1|set_from_proposal_v1_ike|set_from_proposal_v1|get_alg_from_ikev1|get_ikev1_from_alg' \
src/libcharon/encoding/payloads/proposal_substructure.c
```

先看 mapping array，再看 reader/writer，不要从文件第一行顺序读。

---

### 18.3 IKEv2 Transform

```bash
rg -n 'encode_transforms_v2|PLV2_TRANSFORM|Transform ID|TRANSFORM_' \
  src/libcharon/encoding/payloads
```

---

### 18.4 Crypto factory / plugin

```bash
rg -n 'create_crypter|create_signer|create_hasher|create_prf|create_ke' \
  src/libstrongswan/crypto/crypto_factory.c

rg -n 'PLUGIN_PROVIDE|CRYPTER|SIGNER|HASHER|PRF' \
  src/libstrongswan/plugins/openssl
```

---

### 18.5 IKEv1 keymat

```bash
rg -n 'derive_ike_keys|derive_child_keys|create_prf|create_aead|create_hasher|SKEYID' \
  src/libcharon/sa/ikev1/keymat_v1.c

rg -n 'derive_child_keys|child_sa->install' \
  src/libcharon/sa/ikev1/tasks/quick_mode.c
```

---

### 18.6 IKEv2 keymat

```bash
rg -n 'derive_ike_keys|derive_child_keys|SKEYSEED|SK_ai|SK_ar|SK_ei|SK_er|SK_d|prf_plus' \
  src/libcharon/sa/ikev2/keymat_v2.c

rg -n 'derive_child_keys|child_sa->install|CHILD_INSTALLING' \
  src/libcharon/sa/ikev2/tasks/child_create.c
```

---

### 18.7 CHILD_SA / XFRM

```bash
rg -n 'install_internal|kernel_ipsec_add_sa_t|add_sa' \
  src/libcharon/sa/child_sa.c

rg -n 'kernel_algorithm_t|encryption_algs|integrity_algs|lookup_algorithm|add_sa|XFRM_MSG_NEWSA' \
  src/libcharon/plugins/kernel_netlink/kernel_netlink_ipsec.c
```

运行验证：

```bash
ip xfrm state
ip xfrm policy
cat /proc/crypto | grep -A8 -E 'sm4|sm3'
```

---

## 19. 最终结论：真正的改造点不是一个文件，而是一条“语义连续链”

strongSwan 的优势在于已经把国密接入所需的层次拆开：

```text
proposal_t
→ IKE wire encoding
→ crypto factory
→ provider/plugin
→ keymat
→ CHILD_SA
→ kernel interface
→ Linux XFRM
```

因此，对于**算法语义能够复用现有 IKE/IPsec 协议结构**的 SM3/SM4，正确策略通常是：

```text
扩展 internal algorithm
+ proposal token
+ wire mapping
+ crypto plugin/provider
+ key length/truncation
+ XFRM mapping
```

而不是修改整个 IKE 状态机。

但对于 SM2 认证、SM2 密钥交换或目标 GM/T profile 如果改变 IKEv1/IKEv2 报文语义，则必须另外进入：

```text
credential/authentication
key_exchange_t
main_mode/aggressive_mode/ike_init/ike_auth
payload encoding
keymat inputs
```

这也是为什么：

```text
SM4/SM3 接通
≠ 完整国密 IKE
≠ 完整国密 IPsec
```

最终技术结论必须同时证明：

```text
线上 Transform 正确
+ 密码对象真实创建
+ IKE/CHILD 密钥正确派生
+ 内核 SA/Policy 接受
+ ESP 数据面双向工作
```

只有这五层连续闭环，才可以从“改了源码”上升到“功能真正成立”。
