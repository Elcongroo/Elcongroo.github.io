---
title: "附录 A：OpenVPN → Tongsuo 双证书与密钥生命周期源码定位"
description: "沿 SSL_CTX、SSL 和 Tongsuo 握手状态追踪双证书与各层密钥。"
date: "2026-09-29"
updated: "2026-09-29"
category: "crypto"
modules: ["tls", "crypto", "provider"]
editorial: "original"
tags: ["OpenVPN", "TLS", "OpenVPN 专题精读"]
kind: "源码精读"
minutes: 80
featured: false
series: "OpenVPN 专题精读"
seriesOrder: 2
difficulty: "进阶"
prerequisites: ["按正文的概念解释、源码入口与关联文章补齐前置知识"]
environment: ["原稿整理；本次发布未新增运行实验"]
software: ["OpenVPN 2.7.4；涉及 Tongsuo 时按正文指定版本"]
conclusion: "source"
realVerified: false
verificationActor: "保留原稿的源码分析、资料判断与实验边界；未将文档迁移视为新增实测"
provenance: {"title": "附录 A：OpenVPN → Tongsuo 双证书与密钥生命周期源码定位", "mode": "原稿收录", "omissions": []}
changes: [{"date": "2026-09-29", "note": "收录技术原稿；调整标题层级、网页图示与站内链接。"}]
repository: "https://github.com/OpenVPN/openvpn/tree/v2.7.4"
basis: {"label": "OpenVPN 2.7.4 源码", "href": "https://github.com/OpenVPN/openvpn/tree/v2.7.4", "boundary": "上游分析、本地适配与实验记录的区别以原文标注为准。"}
---

> 所属主文档：`OpenVPN / TLS / TLCP / Tongsuo 上游源码研究与国密改造点定位`  
> 文档类型：源码精读附录 / 生命周期定位  
> 研究主题：双证书、TLCP 握手、PMS、Master Secret、Key Block、Exporter、OpenVPN 数据通道边界  
> OpenVPN 上游基线：v2.7.4（发布提交 `8e9e91f4caff9a80`）  
> Tongsuo 基线：8.4.0（Commit `a8ae0925d26de3b449f7a21767910cd41291bcd8`）  
> 本地 PoC：仅作为“候选接入点如何落地”的参考证据，不作为 OpenVPN 上游已有能力描述。

---

### A.1 本附录要回答的问题

本附录不再泛讲 TLS/TLCP 概念，而是沿着真实对象生命周期回答以下问题：

1. OpenVPN 上游的单证书配置从哪里进入 `SSL_CTX`，为什么 TLCP 双证书必然需要上层适配；
2. Tongsuo 如何把 SIGN/ENC 证书和私钥放入不同槽位，并保证角色不混淆；
3. `SSL_CTX` 中的双证书怎样进入一条实际连接的 `SSL` 对象；
4. TLCP Certificate、ServerKeyExchange、ClientKeyExchange 分别读取哪一个证书或私钥；
5. 静态 SM2 套件下 PMS 在哪里产生、在哪里加密、在哪里解密；
6. PMS 如何变成 Master Secret，再变成双方向 MAC key、SM4 key 和 IV；
7. Tongsuo 的 TLCP Exporter 为什么“内部方法表有实现，但公共 API 仍然可能失败”；
8. 为什么 TLCP 控制通道密钥与 OpenVPN 业务数据通道密钥必须分开描述；
9. 如果后续做正式产品化改造，OpenVPN 与 Tongsuo 各自应改到哪一层，哪些层原则上不应重写。

本附录最重要的阅读方法是：

```text
配置/文件
  ↓
SSL_CTX 中的对象
  ↓
SSL_new() 后的单连接对象
  ↓
握手状态机的具体消费者
  ↓
PMS / Master Secret / Key Block
  ↓
TLCP Record
  ↓
Exporter 或 OpenVPN 自身数据通道 KDF
  ↓
OpenVPN Data Channel Cipher
```

只有把“谁写、写到哪里、谁读、读完做什么”闭合起来，才能证明某个改造点真正改变了协议行为。

---

### A.2 证据类型

为避免把“上游事实”“本地 PoC”“工程判断”混在一起，本附录使用以下标记：

- **【OpenVPN 上游源码确认】**：OpenVPN v2.7.4 原始上游源码已确认；
- **【Tongsuo 上游源码确认】**：Tongsuo 8.4.0 / 指定 Commit 源码已确认；
- **【本地适配参考】**：当前 OpenVPN→Tongsuo PoC 中已经出现的接线方式，只用于证明候选改造点可落地；
- **【协议行为推导】**：由已确认源码的对象流、分支和消费者关系推出；
- **【改造判断】**：面向正式产品的候选改造边界；
- **【待运行验证】**：静态源码不能证明，必须通过日志、断点、抓包、密钥日志或互通测试确认。

> 行号绑定当前源码快照。OpenVPN 本地 PoC 会使 `ssl_openssl.c` 等文件行号相对上游发生偏移，因此本附录优先同时给出“函数名 + 文件 + 当前行号”。升级版本后必须重新按符号定位。

---

## A.3 总体生命周期：先看全局，再进入细节

```text
                     OpenVPN 配置层
                          │
               ┌──────────┴──────────┐
               │                     │
         上游单证书模型          TLCP候选双证书模型
       cert + private-key       SIGN cert/key
                               ENC  cert/key
               │                     │
               └──────────┬──────────┘
                          ▼
                     tls_root_ctx
                          │
                          ▼
                       SSL_CTX
                          │
                    Tongsuo CERT
                 ┌────────┴────────┐
                 ▼                 ▼
       pkeys[SM2_SIGN]       pkeys[SM2_ENC]
         SIGN cert/key         ENC cert/key
                 │                 │
                 └────────┬────────┘
                          │ SSL_new()
                          ▼
                         SSL
                          │
                 ssl_cert_dup(ctx->cert)
                          │
                          ▼
                  单连接 s->cert
                          │
         ┌────────────────┼────────────────┐
         ▼                ▼                ▼
   Certificate      ServerKeyExchange   ClientKeyExchange
 SIGN + ENC证书     SIGN私钥签名         ENC公钥加密PMS
                     绑定ENC证书          ENC私钥解密PMS
         │                │                │
         └────────────────┴───────┬────────┘
                                  ▼
                                 PMS
                                  │
                         tls1_generate_master_secret()
                                  ▼
                            Master Secret
                                  │
                         tls1_setup_key_block()
                                  ▼
                              Key Block
               ┌──────────────────┼──────────────────┐
               ▼                  ▼                  ▼
          client/server      client/server      client/server
            MAC secret        SM4 key              IV
               │                  │                  │
               └──────────────────┼──────────────────┘
                                  ▼
                      TLCP Record Protection
                       tls1_mac + ssl3_enc
                                  │
                                  ▼
                    OpenVPN TLS控制通道明文
                                  │
               ┌──────────────────┴──────────────────┐
               ▼                                     ▼
       TLS/TLCP Exporter可用                    Exporter不可用/未协商
               │                                     │
               ▼                                     ▼
  OpenVPN Data Channel key2              OpenVPN legacy key_source2 PRF
               │                                     │
               └──────────────────┬──────────────────┘
                                  ▼
                     OpenVPN Data Channel Cipher
```

这里有两条必须始终区分的密钥生命周期：

```text
生命周期 1：Tongsuo TLCP 控制通道
TLCP PMS → TLCP Master Secret → TLCP Key Block → SM4/HMAC-SM3 Record

生命周期 2：OpenVPN 业务数据通道
TLS Exporter 输出 或 OpenVPN legacy PRF → key2 → OpenVPN Data Cipher/HMAC/AEAD
```

**【协议行为推导】**：生命周期 1 成功，不能自动证明生命周期 2 使用 SM2/SM3/SM4。

---

## A.4 第一层：OpenVPN 配置加载为什么是双证书改造的起点

### A.4.1 上游 OpenVPN 只有“一份本端证书 + 一份本端私钥”语义

#### 源码位置

**【OpenVPN 上游源码确认】**

```text
src/openvpn/ssl.c
    init_ssl()

src/openvpn/ssl_openssl.c
    tls_ctx_load_cert_pem_file()   上游 v2.7.4: 1192-1247
    tls_ctx_load_cert_file()       上游 v2.7.4: 1249-1259
    tls_ctx_load_priv_file()       上游 v2.7.4: 1261-1308
```

上游 `tls_ctx_load_cert_pem_file()` 的核心落点是：

```text
PEM_read_bio_X509()
    ↓
SSL_CTX_use_certificate(ctx->ctx, x)
```

上游 `tls_ctx_load_priv_file()` 的核心落点是：

```text
PEM / URI private key
    ↓
SSL_CTX_use_PrivateKey(ssl_ctx, pkey)
    ↓
SSL_CTX_check_private_key(ssl_ctx)
```

在 `init_ssl()` 中，上层配置也是单值语义：

```text
options->cert_file
options->priv_key_file
```

因此，上游 OpenVPN 的证书模型天然假定：

```text
一个TLS身份
  ├─ certificate
  └─ private key
```

而不是：

```text
一个TLCP身份
  ├─ SIGN certificate/private key
  └─ ENC  certificate/private key
```

#### 对象状态变化

上游加载完成后，OpenVPN 只知道：

```text
tls_root_ctx
   ↓
SSL_CTX
   ↓
“默认/当前证书与私钥已加载”
```

OpenVPN 本身不知道“签名角色”和“加密角色”这两个语义。

#### 为什么这是正式改造的 P0 点

**【改造判断】**：正式 TLCP 支持不能只在 Tongsuo 内部完成。即便 Tongsuo 已经支持双证书，如果 OpenVPN 配置层没有办法表达两组证书，OpenVPN 就无法稳定、可审计地把正确材料交给 Tongsuo。

正式产品建议将配置语义扩展为类似：

```text
tlcp-sign-cert
ntlcp-sign-key
tlcp-enc-cert
tlcp-enc-key
```

或者更抽象地定义：

```text
certificate-provider:
  sign_identity
  enc_identity
```

不能把“两个 PEM 文件路径”直接散落在状态机代码里。

---

### A.4.2 当前 PoC 如何证明这个候选接入点可行

#### 源码位置

**【本地适配参考】** 当前 OpenVPN 2.7.4 适配快照：

```text
src/openvpn/ssl_openssl.c:82-132
    tongsuo_ntls_enabled()
    tongsuo_required_env()
    tongsuo_load_dual_certificates()

src/openvpn/ssl_openssl.c:1474-1478
    tls_ctx_load_priv_file() 内调用 tongsuo_load_dual_certificates()
```

PoC 使用环境变量：

```text
OPENVPN_TLCP_SIGN_CERT
OPENVPN_TLCP_SIGN_KEY
OPENVPN_TLCP_ENC_CERT
OPENVPN_TLCP_ENC_KEY
```

随后调用：

```text
SSL_CTX_use_sign_certificate_file()
SSL_CTX_use_sign_PrivateKey_file()
SSL_CTX_check_private_key()

SSL_CTX_use_enc_certificate_file()
SSL_CTX_use_enc_PrivateKey_file()
SSL_CTX_check_private_key()
```

#### 这段 PoC 能证明什么

**【本地适配参考】**：OpenVPN 的 `SSL_CTX` 初始化阶段确实可以作为双证书注入边界，不需要在 OpenVPN 内实现 TLCP Certificate/ServerKeyExchange 报文。

#### 这段 PoC 不能证明什么

- 环境变量不是正式 OpenVPN 配置模型；
- 双证书加载成功不等于握手消费者一定读到了正确槽位；
- `SSL_CTX_check_private_key()` 成功不等于已经证明两组证书均被独立检查，必须继续读 Tongsuo 内部 `CERT::key` 行为；
- 加载双证书不等于 OpenVPN 数据通道使用国密算法。

---

## A.5 第二层：Tongsuo 如何把 SIGN/ENC 放进不同槽位

### A.5.1 双证书不是“四个松散指针”，而是两个角色槽位

#### 源码位置

**【Tongsuo 上游源码确认】**

```text
ssl/ssl_local.h:385-389
    SSL_PKEY_SM2_SIGN = 7
    SSL_PKEY_SM2_ENC  = 8

ssl/ssl_local.h:2094-2108
    struct cert_pkey_st

ssl/ssl_local.h:2157-2171
    struct cert_st
```

关键结构可以简化成：

```c
struct cert_pkey_st {
    X509 *x509;
    EVP_PKEY *privatekey;
    ...
};

struct cert_st {
    CERT_PKEY *key;                  // 当前活动槽
    CERT_PKEY pkeys[SSL_PKEY_NUM];   // 所有角色槽
    ...
};
```

对象关系为：

```text
CERT
├─ pkeys[7]  = SM2 SIGN
│   ├─ x509
│   └─ privatekey
│
├─ pkeys[8]  = SM2 ENC
│   ├─ x509
│   └─ privatekey
│
└─ key ─────→ 当前最近被 setter 激活的 pkeys[i]
```

`CERT::key` **不是私钥**，而是“当前活动 `CERT_PKEY` 槽”的指针。

---

### A.5.2 SIGN/ENC API 如何选择不同槽位

#### 源码位置

**【Tongsuo 上游源码确认】**

```text
ssl/ssl_rsa.c:1312-1370
    SSL_CTX_use_enc_PrivateKey()
    SSL_CTX_use_enc_PrivateKey_file()

ssl/ssl_rsa.c:1372-1430
    SSL_CTX_use_sign_PrivateKey()
    SSL_CTX_use_sign_PrivateKey_file()

ssl/ssl_rsa.c:1433-1513
    SSL_CTX_use_enc_certificate()
    SSL_CTX_use_enc_certificate_file()

ssl/ssl_rsa.c:1515-1595
    SSL_CTX_use_sign_certificate()
    SSL_CTX_use_sign_certificate_file()
```

当密钥类型为 SM2：

```text
SSL_CTX_use_sign_*()
    → i = SSL_PKEY_SM2_SIGN

SSL_CTX_use_enc_*()
    → i = SSL_PKEY_SM2_ENC
```

然后统一进入：

```text
ssl_set_cert_idx(ctx->cert, x509, i)
ssl_set_pkey_idx(ctx->cert, pkey, i)
```

这说明角色并不是靠“证书文件名里有 SIGN/ENC”维持，而是 API 把同一种 SM2 算法对象写进了两个不同的 `pkeys[]` 索引。

---

### A.5.3 真正的字段写入在哪里

#### 源码位置

**【Tongsuo 上游源码确认】**

```text
ssl/ssl_rsa.c:1242-1278  ssl_set_cert_idx()
ssl/ssl_rsa.c:1281-1310  ssl_set_pkey_idx()
```

证书写入后：

```text
c->pkeys[i].x509 = x
c->key = &c->pkeys[i]
```

私钥写入后：

```text
c->pkeys[i].privatekey = pkey
c->key = &c->pkeys[i]
```

因此调用：

```text
load SIGN cert
load SIGN key
```

后，`CERT::key` 指向 SIGN；随后调用：

```text
load ENC cert
load ENC key
```

后，`CERT::key` 改为指向 ENC。

#### 状态图

```text
加载 SIGN 前
CERT::pkeys[7] = empty
CERT::pkeys[8] = empty

        ↓ SSL_CTX_use_sign_certificate()

pkeys[7].x509 = SIGN cert
CERT::key ─→ pkeys[7]

        ↓ SSL_CTX_use_sign_PrivateKey()

pkeys[7].privatekey = SIGN key
CERT::key ─→ pkeys[7]

        ↓ SSL_CTX_use_enc_certificate()

pkeys[8].x509 = ENC cert
CERT::key ─→ pkeys[8]

        ↓ SSL_CTX_use_enc_PrivateKey()

pkeys[8].privatekey = ENC key
CERT::key ─→ pkeys[8]
```

---

### A.5.4 `SSL_CTX_check_private_key()` 为什么依赖调用顺序

#### 源码位置

**【Tongsuo 上游源码确认】**

```text
ssl/ssl_lib.c:1705-1717
    SSL_CTX_check_private_key()
```

函数并不遍历全部 `pkeys[]`，而是检查：

```text
ctx->cert->key->x509
       ↕
ctx->cert->key->privatekey
```

而 Tongsuo 源码在该函数前直接保留注释：

```text
Fix this so it checks all the valid key/cert options
```

因此当前 PoC 的调用顺序：

```text
SIGN cert/key
→ check
→ ENC cert/key
→ check
```

具有真实安全语义：

```text
第一次 check：CERT::key 指向 SIGN
第二次 check：CERT::key 指向 ENC
```

如果将代码“整理”为：

```text
load SIGN
load ENC
最后只 check 一次
```

最后一次 setter 已使 `CERT::key` 指向 ENC，最终检查只能证明 ENC pair 匹配，不能再证明 SIGN pair 匹配。

**【改造判断】**：正式双证书加载接口最好显式提供“检查两组角色”的能力，或者分别在 setter 后校验，不要隐式依赖最后一个活动槽却声称“检查了所有证书”。

---

## A.6 第三层：`SSL_CTX` 双证书如何进入一条真实连接

### A.6.1 OpenVPN 创建单连接 `SSL`

#### 源码位置

**【OpenVPN 上游源码确认】**

```text
src/openvpn/ssl_openssl.c:2079-2114（上游 v2.7.4）
    key_state_ssl_init()
```

关键生命周期：

```text
SSL_new(ssl_ctx->ctx)
    ↓
SSL_set_accept_state() / SSL_set_connect_state()
    ↓
BIO_new(BIO_f_ssl())
BIO_new(BIO_s_mem())  // ct_in
BIO_new(BIO_s_mem())  // ct_out
    ↓
SSL_set_bio()
```

OpenVPN 自此持有：

```text
key_state_ssl
├─ SSL *ssl
├─ BIO *ssl_bio
├─ BIO *ct_in
└─ BIO *ct_out
```

OpenVPN 后续只是把网络收到的密文字节写入 `ct_in`，从 `ct_out` 取 Tongsuo 产生的协议字节；把 OpenVPN 控制消息写入 `ssl_bio`，再从 `ssl_bio` 读出 Tongsuo 解密后的控制通道明文。

---

### A.6.2 Tongsuo `SSL_new()` 复制证书状态

#### 源码位置

**【Tongsuo 上游源码确认】**

```text
ssl/ssl_lib.c:689-754
    SSL_new()

ssl/ssl_cert.c:76-114
    ssl_cert_dup()
```

`SSL_new(ctx)` 中：

```text
s->enable_ntls = ctx->enable_ntls
s->cert = ssl_cert_dup(ctx->cert)
```

`ssl_cert_dup()` 会遍历：

```text
for (i = 0; i < SSL_PKEY_NUM; i++)
```

对每个 `CERT_PKEY` 做引用计数复制：

```text
ctx->cert->pkeys[i].x509
    ↓
ssl->cert->pkeys[i].x509

ctx->cert->pkeys[i].privatekey
    ↓
ssl->cert->pkeys[i].privatekey
```

因此对象边界是：

```text
初始化模板
SSL_CTX::cert
  ├─ SIGN
  └─ ENC
       │
       │ SSL_new / ssl_cert_dup
       ▼
单连接运行对象
SSL::cert
  ├─ SIGN
  └─ ENC
```

这一步完成后，后续握手状态机主要读取 `s->cert`，不需要重新读取 OpenVPN 配置文件。

---

## A.7 第四层：套件选择后，Tongsuo 把 SIGN/ENC 绑定为本次握手临时状态

双证书存在于 `s->cert->pkeys[]` 只是“材料存在”。要证明握手会使用它们，还需要继续追状态机选择。

### A.7.1 临时握手字段

#### 源码位置

**【Tongsuo 上游源码确认】**

```text
ssl/ssl_local.h:1389-1408
```

握手临时状态中包括：

```text
s->s3.tmp.pms
s->s3.tmp.pmslen
s->s3.tmp.sigalg
s->s3.tmp.cert
s->s3.tmp.sign_cert
s->s3.tmp.enc_cert
```

`pkeys[]` 是长期连接证书集合；`s->s3.tmp.sign_cert/enc_cert` 是“当前这次握手实际选择的角色指针”。

---

### A.7.2 `tls_choose_sigalg_ntls()` 建立本次握手的角色绑定

#### 源码位置

**【Tongsuo 上游源码确认】**

```text
ssl/t1_lib.c:999-1003
    ntls_sm2_sigalg

ssl/t1_lib.c:3220-3256
    tls_choose_sigalg_ntls()
```

SM2 的 NTLS 签名算法描述中：

```text
sig_idx = SSL_PKEY_SM2_SIGN
```

选择 SM2 主链后：

```text
s->s3.tmp.sign_cert = &s->cert->pkeys[lu->sig_idx]
s->s3.tmp.enc_cert  = &s->cert->pkeys[lu->sig_idx + 1]
```

由于 `SSL_PKEY_SM2_SIGN=7`、`SSL_PKEY_SM2_ENC=8`，最终就是：

```text
s->s3.tmp.sign_cert ─→ pkeys[7]
s->s3.tmp.enc_cert  ─→ pkeys[8]
```

这一步很关键：

> 初始化阶段使用 `CERT::key` 表示“当前被 setter 操作的槽”；真正进入握手后，状态机改用 `tmp.sign_cert` / `tmp.enc_cert` 或直接访问 `pkeys[SIGN/ENC]`，不再依赖“当前活动槽”猜角色。

---

## A.8 第五层：Certificate 消息如何发送双证书

### A.8.1 服务端构造 Certificate

#### 源码位置

**【Tongsuo 上游源码确认】**

```text
ssl/statem_ntls/ntls_statem_srvr.c:2225-2240
    tls_construct_server_certificate_ntls()

ssl/statem_ntls/ntls_statem_lib.c:722-732
    ssl_add_cert_chain_ntls() 的双证书写入顺序

ssl/statem_ntls/ntls_statem_lib.c:747-765
    ssl3_output_cert_chain_ntls()
```

`tls_construct_server_certificate_ntls()` 直接取得：

```text
s->s3.tmp.sign_cert
s->s3.tmp.enc_cert
```

随后 `ssl_add_cert_chain_ntls()` 按顺序写入：

```text
1. SIGN certificate
2. ENC certificate
3. extra chain certificates
```

因此 TLCP Certificate 报文中的两张叶子证书不是“OpenVPN 拼接出来的”，而是 Tongsuo NTLS 状态机根据角色槽直接编码。

---

### A.8.2 客户端如何恢复双证书顺序

#### 源码位置

**【Tongsuo 上游源码确认】**

```text
ssl/statem_ntls/ntls_statem_clnt.c:1239-1335
    tls_process_server_certificate_ntls()
```

客户端逐个解析 Certificate 中的 X.509，并按收到顺序压入：

```text
s->session->peer_chain
```

后续源码明确使用如下语义：

```text
peer_chain[0] = server SIGN certificate
peer_chain[1] = server ENC certificate
```

这一点在 `tls_construct_cke_pms_ntls()` 的源码注释和读取逻辑中再次得到直接确认。

#### 改造与验证意义

**【待运行验证】**：抓包时不能只确认“Certificate 中有两张证书”。还应验证：

1. 第一张是否为 SIGN 证书；
2. 第二张是否为 ENC 证书；
3. 证书 KeyUsage/角色是否符合预期；
4. 后续 ServerKeyExchange 的签名能否用第一张 SIGN 证书验证；
5. ClientKeyExchange 是否使用第二张 ENC 证书公钥。

---

## A.9 第六层：ServerKeyExchange 如何把 SIGN 身份与 ENC 证书绑定

这是双证书设计中最关键的“绑定”动作之一。

### A.9.1 消费 SIGN 私钥和 ENC 证书

#### 源码位置

**【Tongsuo 上游源码确认】**

```text
ssl/statem_ntls/ntls_statem_srvr.c:1630-1792
    tls_construct_server_key_exchange_ntls()
```

静态 SM2 分支明确读取：

```text
pkey = s->cert->pkeys[SSL_PKEY_SM2_SIGN].privatekey
x509 = s->cert->pkeys[SSL_PKEY_SM2_ENC].x509
```

也就是说，在同一个 ServerKeyExchange 构造函数中：

```text
SIGN private key 负责签名
ENC  certificate 作为被签名数据的一部分
```

---

### A.9.2 到底签了什么

#### 源码位置

**【Tongsuo 上游源码确认】**

```text
ssl/statem_ntls/ntls_statem_srvr.c:1754-1778

ssl/statem_ntls/ntls_statem_lib.c:1838-1854
    construct_key_exchange_tbs_ntls()
```

静态 SM2/RSA 路径先把 ENC 证书转换为编码数据，然后构造待签名数据：

```text
ClientRandom
|| ServerRandom
|| ENC certificate encoding
```

随后通过：

```text
EVP_DigestSignInit_ex(... SIGN private key ...)
EVP_DigestSign(...)
```

生成签名。

因此 SIGN 私钥的语义不只是“给某个临时参数签名”，而是：

> 用服务端签名身份对本次会话随机数与 ENC 证书进行绑定，使客户端能够确认“这张用于 PMS 加密的 ENC 证书属于当前被认证的服务端身份”。

#### 下一消费者

客户端处理 ServerKeyExchange 时会取 `peer_chain[1]` 的 ENC 证书编码重新构造待验数据，并验证服务端签名。

**【Tongsuo 上游源码确认】**：

```text
ssl/statem_ntls/ntls_statem_clnt.c:1516-1523
    读取 peer_chain[1] ENC certificate
```

---

## A.10 第七层：静态 SM2 ClientKeyExchange 与 PMS 生命周期

本节只讨论当前重点套件中的静态 SM2 密钥传输，不把它与 SM2DHE 混淆。

### A.10.1 套件为什么进入静态 SM2 分支

#### 源码位置

**【Tongsuo 上游源码确认】**

```text
ssl/s3_lib.c:2384-2398
    ECC-SM2-SM4-CBC-SM3
```

该套件记录的核心算法位为：

```text
algorithm_mkey = SSL_kSM2
algorithm_auth = SSL_aSM2
algorithm_enc  = SSL_SM4
algorithm_mac  = SSL_SM3
algorithm2     包含 TLS1_PRF_SM3
```

因此 ClientKeyExchange 分派：

```text
SSL_kSM2
    ↓
tls_construct_cke_pms_ntls()
```

而不是：

```text
SSL_kSM2DHE
    ↓
tls_construct_cke_sm2dhe_ntls()
```

---

### A.10.2 客户端生成 PMS

#### 源码位置

**【Tongsuo 上游源码确认】**

```text
ssl/statem_ntls/ntls_statem_clnt.c:1893-1975
    tls_construct_cke_pms_ntls()
```

客户端明确取得：

```text
peer_chain[1]
    ↓
server ENC certificate
    ↓
X509_get0_pubkey()
```

随后生成 PMS：

```text
pmslen = SSL_MAX_MASTER_KEY_LENGTH
pms[0..1] = client_version
pms[2..]  = RAND_bytes_ex(...)
```

然后创建 `EVP_PKEY_CTX` 并执行：

```text
EVP_PKEY_encrypt_init()
EVP_PKEY_encrypt(... PMS ...)
```

密文进入 ClientKeyExchange。

同时客户端把本地明文 PMS 暂存到：

```text
s->s3.tmp.pms
s->s3.tmp.pmslen
```

#### 对象状态

```text
收到服务端双证书后
peer_chain[0] = SIGN cert
peer_chain[1] = ENC cert

        ↓
生成 PMS

s->s3.tmp.pms = PMS

        ↓ ENC public key

ClientKeyExchange = SM2_Encrypt(PMS)
```

---

### A.10.3 服务端用 ENC 私钥解密 PMS

#### 源码位置

**【Tongsuo 上游源码确认】**

```text
ssl/statem_ntls/ntls_statem_srvr.c:1827-1942
    tls_process_cke_pms_ntls()
```

静态 SM2 分支直接取：

```text
s->cert->pkeys[SSL_PKEY_SM2_ENC].privatekey
```

如果为空：

```text
SSL_R_MISSING_ENC_CERTIFICATE
```

随后：

```text
EVP_PKEY_CTX_new_from_pkey(... ENC private key ...)
EVP_PKEY_decrypt_init()
EVP_PKEY_decrypt(... encrypted PMS ...)
```

解密得到明文 PMS 后立即进入：

```text
ssl_generate_master_secret()
```

#### 失败边界

此处失败意味着：

```text
Certificate 已经可能发送成功
ServerKeyExchange 也可能已经签名成功
但静态 SM2 密钥建立失败
```

因此出现 `ClientKeyExchange` 后握手失败时，不能只检查 SIGN 证书。ENC 私钥、SM2 decrypt provider、密文长度和证书角色都是直接候选点。

---

## A.11 第八层：PMS → Master Secret

### A.11.1 客户端和服务端最终进入同一个 Master Secret 接口

客户端：

**【Tongsuo 上游源码确认】**

```text
ssl/statem_ntls/ntls_statem_clnt.c:2055-2073
    tls_client_key_exchange_post_work_ntls()
        → ssl_generate_master_secret()
```

服务端：

```text
ssl/statem_ntls/ntls_statem_srvr.c:1931-1936
    tls_process_cke_pms_ntls()
        → ssl_generate_master_secret()
```

公共包装：

```text
ssl/s3_lib.c:3895-3958
    ssl_generate_master_secret()
```

这里通过方法表调用：

```text
s->method->ssl3_enc->generate_master_secret(...)
```

---

### A.11.2 NTLS 方法表实际复用 `tls1_generate_master_secret()`

#### 源码位置

**【Tongsuo 上游源码确认】**

```text
ssl/t1_lib.c:104-120
    NTLS_enc_data
```

其中：

```text
setup_key_block          → tls1_setup_key_block
generate_master_secret  → tls1_generate_master_secret
change_cipher_state     → tls1_change_cipher_state
final_finish_mac        → tls1_final_finish_mac
export_keying_material  → tls1_export_keying_material
```

这说明 Tongsuo 没有为 NTLS 复制一整套独立 KDF 文件，而是通过 `SSL3_ENC_METHOD` 方法表把 NTLS 状态机连接到 TLS1 风格的密钥派生/记录密码基础设施。

---

### A.11.3 `tls1_generate_master_secret()` 的输入

#### 源码位置

**【Tongsuo 上游源码确认】**

```text
ssl/t1_enc.c:604-664
    tls1_generate_master_secret()
```

普通非 Extended Master Secret 路径：

```text
secret = PMS
seed   = ClientRandom || ServerRandom
label  = "master secret"
    ↓
tls1_PRF()
    ↓
48-byte Master Secret
```

Master Secret 存入：

```text
s->session->master_key
s->session->master_key_length
```

---

### A.11.4 为什么这里实际会使用 SM3 PRF

#### 源码位置

**【Tongsuo 上游源码确认】**

```text
ssl/t1_enc.c:25-84
    tls1_PRF()

ssl/ssl_ciph.c:531-534
    ssl_prf_md()

ssl/s3_lib.c:2384-2398
    ECC-SM2-SM4-CBC-SM3 的 algorithm2
```

`tls1_PRF()` 不是写死 SHA256/SM3，而是：

```text
ssl_prf_md(s)
    ↓
ssl_get_algorithm2(s)
    ↓
当前 cipher suite 的 TLS1_PRF_* 位
```

`ECC-SM2-SM4-CBC-SM3` 的 `algorithm2` 包含：

```text
TLS1_PRF_SM3
```

因此当前 suite 选择完成后，PRF 摘要被解析为 SM3，再交给 `EVP_KDF` 的 `TLS1-PRF` 实现。

完整链：

```text
new_cipher = ECC-SM2-SM4-CBC-SM3
    ↓
algorithm2 contains TLS1_PRF_SM3
    ↓
ssl_prf_md() = SM3
    ↓
tls1_PRF(secret=PMS, digest=SM3)
    ↓
Master Secret
```

---

## A.12 第九层：Master Secret → Key Block → 方向密钥

### A.12.1 生成 Key Block

#### 源码位置

**【Tongsuo 上游源码确认】**

```text
ssl/t1_enc.c:86-99
    tls1_generate_key_block()

ssl/t1_enc.c:493-575
    tls1_setup_key_block()
```

`tls1_setup_key_block()` 首先根据已协商 cipher 获取：

```text
cipher
hash
mac_secret_size
cipher key length
IV length
```

然后计算：

```text
num = 2 * (MAC_secret_len + cipher_key_len + IV_len)
```

说明 Key Block 一次生成两套方向材料。

`t1_generate_key_block()` 使用：

```text
secret = Master Secret
label  = "key expansion"
seed   = ServerRandom || ClientRandom
```

再经同一个 `tls1_PRF()` 派生 `s->s3.tmp.key_block`。

注意 Master Secret 与 Key Block 的随机数顺序不同：

```text
Master Secret：ClientRandom || ServerRandom
Key Block：    ServerRandom || ClientRandom
```

---

### A.12.2 Key Block 如何切分为两个方向

#### 源码位置

**【Tongsuo 上游源码确认】**

```text
ssl/t1_enc.c:186-488
    tls1_change_cipher_state()

重点：312-357、364-391
```

函数根据：

```text
CLIENT_WRITE / SERVER_READ
SERVER_WRITE / CLIENT_READ
```

从同一 `key_block` 中选择对应偏移，得到：

```text
mac_secret
cipher key
iv
```

逻辑可表示为：

```text
Key Block
│
├─ client_write_MAC_secret
├─ server_write_MAC_secret
├─ client_write_key
├─ server_write_key
├─ client_write_IV
└─ server_write_IV
```

随后：

```text
MAC secret
  ↓
EVP_PKEY_new_raw_private_key_ex(... "HMAC" ...)
EVP_DigestSignInit_ex(... negotiated hash ...)

SM4 key + IV
  ↓
EVP_CipherInit_ex(... negotiated cipher ...)
```

对于当前 CBC suite：

```text
negotiated cipher = SM4-CBC
negotiated MAC    = HMAC-SM3
```

---

## A.13 第十层：Key Block 最终在哪里保护 TLCP Record

### A.13.1 SM4-CBC 映射

#### 源码位置

**【Tongsuo 上游源码确认】**

```text
ssl/ssl_ciph.c:49-52
```

Tongsuo 将：

```text
SSL_SM4 → NID_sm4_cbc
```

因此 `tls1_setup_key_block()` 取得的 `EVP_CIPHER` 对应 SM4-CBC。

---

### A.13.2 Record 加解密

#### 源码位置

**【Tongsuo 上游源码确认】**

```text
ssl/record/ssl3_record.c:855-935...
    ssl3_enc()
```

实际 Record 加解密最终通过当前连接的：

```text
s->enc_write_ctx
s->enc_read_ctx
```

执行 `EVP_CipherUpdate()` 等 EVP cipher 调用。

CBC padding、解密合法性等也在该记录处理路径完成。

---

### A.13.3 Record MAC

#### 源码位置

**【Tongsuo 上游源码确认】**

```text
ssl/record/ssl3_record.c:1396-1462...
    tls1_mac()
```

MAC 输入包括：

```text
record sequence number
record type
protocol version
record length
record plaintext/ciphertext stage data
```

实际 MAC 通过已经在 `tls1_change_cipher_state()` 中初始化的 HMAC 上下文执行：

```text
EVP_DigestSignUpdate()
EVP_DigestSignFinal()
```

由于当前 suite 的 MAC 为 `SSL_SM3`，对应 HMAC-SM3。

#### 至此可以证明的范围

**【协议行为推导】**：当 `ECC-SM2-SM4-CBC-SM3` 被实际协商并完成上述密钥安装后，可以从源码链证明：

```text
TLCP 控制通道 Record
= SM4-CBC encryption
+ HMAC-SM3 integrity
```

但这里的 `Record` 是 Tongsuo `SSL` 控制通道的记录层，不是 OpenVPN TUN/TAP 业务数据包的 Data Channel 加密层。

---

## A.14 第十一层：Finished 与“双方是否真的得到相同 Master Secret”

虽然本附录重点是密钥生命周期，但 Finished 是判断前述 KDF 是否闭环的重要消费者。

#### 源码位置

**【Tongsuo 上游源码确认】**

```text
ssl/t1_enc.c:577-601
    tls1_final_finish_mac()
```

它对当前握手 transcript hash 做处理，并再次使用：

```text
s->session->master_key
    ↓
tls1_PRF()
```

得到 Finished verify data。

因此如果双方 PMS、随机数、PRF digest 或 Master Secret 任一不一致，Finished 校验最终无法成立。

**【待运行验证】**：抓包看到双方 Finished 并完成握手，是“双方得到兼容密钥状态”的重要运行证据，但仍然不是 OpenVPN Data Channel 国密化证据。

---

## A.15 第十二层：Exporter——Tongsuo 内部“有函数”，公共入口却可能到不了

这一层是 OpenVPN 与 TLCP 集成最容易被误判的边界之一。

### A.15.1 OpenVPN 上游如何使用 Exporter

#### 源码位置

**【OpenVPN 上游源码确认】**

```text
src/openvpn/ssl_openssl.c:150-165（上游 v2.7.4）
    key_state_export_keying_material()
```

核心关系：

```text
OpenVPN tls_session
    ↓
SSL *ssl
    ↓
SSL_export_keying_material(...)
```

如果成功，OpenVPN 得到一段与当前 TLS session 绑定的 keying material；失败则清零输出并返回 false。

---

### A.15.2 Tongsuo NTLS 方法表确实挂了 exporter

#### 源码位置

**【Tongsuo 上游源码确认】**

```text
ssl/t1_lib.c:104-120
    NTLS_enc_data
```

其中明确存在：

```text
export_keying_material → tls1_export_keying_material
```

因此不能写成：

> “Tongsuo NTLS 完全没有 exporter 实现。”

更准确的源码结论是：

> **NTLS 的 `SSL3_ENC_METHOD` 方法表已经挂接 `tls1_export_keying_material()`。**

---

### A.15.3 公共 `SSL_export_keying_material()` 的版本门禁

#### 源码位置

**【Tongsuo 上游源码确认】**

```text
ssl/ssl_lib.c:3209-3220
    SSL_export_keying_material()
```

在真正调用：

```text
s->method->ssl3_enc->export_keying_material(...)
```

之前，公共 API 先检查：

```text
s->session != NULL
并且
s->version >= TLS1_VERSION
（DTLS 特例除外）
```

TLCP/NTLS 使用的协议版本值在数值上低于 `TLS1_VERSION`，因此当前 NTLS 连接会在公共 wrapper 处提前返回，根本到不了 `NTLS_enc_data` 中已经存在的 `tls1_export_keying_material()`。

#### 正确的故障链

```text
NTLS method table
  └─ exporter = tls1_export_keying_material   [存在]

OpenVPN
  ↓
SSL_export_keying_material()
  ↓
version gate
  X  提前返回

因此：method table exporter 没有被调用
```

#### 对当前 PoC 注释的纠偏

**【本地适配参考 + Tongsuo 上游源码确认】**：当前 PoC 中曾用注释描述“NTLS state machine does not provide SSL_export_keying_material()”。从 Tongsuo 8.4.0 静态源码看，这个表述不够精确。

更严谨的公司文档应写：

> Tongsuo 8.4.0 的 NTLS `SSL3_ENC_METHOD` 已挂接 `tls1_export_keying_material()`；但公共 `SSL_export_keying_material()` 在调用方法表前执行普通 TLS 版本数值检查，NTLS 版本被该门禁提前拒绝。

这类纠偏非常重要，因为两个结论对应完全不同的改造层：

```text
“内部没实现”
→ 需要补 KDF/exporter 实现

“内部已有实现，公共入口门禁不兼容”
→ 优先修接口/版本分派边界
```

---

### A.15.4 `tls1_export_keying_material()` 实际依赖什么

#### 源码位置

**【Tongsuo 上游源码确认】**

```text
ssl/t1_enc.c:667-735...
    tls1_export_keying_material()
```

输入核心为：

```text
label
ClientRandom
ServerRandom
optional context
Master Secret
```

最后仍然进入：

```text
tls1_PRF()
```

对于 `ECC-SM2-SM4-CBC-SM3`，如果该函数能够被正确调用，PRF digest 仍会根据 cipher suite 解析为 SM3。

**【改造判断】**：正式解决方案应先明确 OpenVPN 期望的 exporter 语义与 TLCP/Tongsuo 的兼容性，再决定：

1. 修正 Tongsuo 公共 exporter 对 NTLS 的版本判断；或
2. 在 OpenVPN Tongsuo backend 中增加明确的 NTLS exporter API；
3. 同时补正负测试，禁止 exporter 失败后无声明地切换为另一套 KDF 并仍宣称“完整国密数据通道”。

---

## A.16 第十三层：OpenVPN 数据通道为什么是另一套密钥生命周期

这是整份附录最需要在公司文档中反复强调的边界。

### A.16.1 OpenVPN 自己维护 Data Channel 状态

#### 源码位置

**【OpenVPN 上游源码确认】**

```text
src/openvpn/ssl_common.h:120-142
    struct key_source
    struct key_source2

src/openvpn/ssl.c:1543-1571（当前 2.7.4 快照，上游逻辑）
    tls_session_generate_data_channel_keys()
```

OpenVPN `key_state` 状态机在 TLS 控制通道认证完成后，还要进入：

```text
S_ACTIVE
    ↓
生成 Data Channel keys
    ↓
S_GENERATED_KEYS
```

这意味着：

```text
TLS/TLCP握手完成
≠ OpenVPN数据通道密钥已经产生
```

---

### A.16.2 两个名字都叫 `pre_master`，但绝对不是同一个 PMS

这是最容易造成误解的地方。

#### Tongsuo TLCP PMS

**【Tongsuo 上游源码确认】**

```text
s->s3.tmp.pms
```

生命周期：

```text
客户端生成
→ ENC公钥加密
→ ClientKeyExchange
→ 服务端ENC私钥解密
→ TLCP Master Secret
→ TLCP Key Block
```

它属于 **Tongsuo SSL/TLCP 会话内部**。

#### OpenVPN `key_source.pre_master`

**【OpenVPN 上游源码确认】**

```text
src/openvpn/ssl_common.h:120-130

struct key_source {
    uint8_t pre_master[48];
    uint8_t random1[32];
    uint8_t random2[32];
};
```

它属于 OpenVPN **Key Method 2 / Data Channel key generation**。

生命周期为：

```text
OpenVPN客户端生成 key_source2.client.pre_master
    ↓
作为 OpenVPN 控制消息明文的一部分
    ↓
通过已经建立的 TLS/TLCP 控制通道安全传输
    ↓
双方 OpenVPN 进程获得相同 key_source2 材料
    ↓
仅在 legacy OpenVPN PRF 路径中产生 Data Channel key2
```

**两者没有对象继承关系：**

```text
Tongsuo s->s3.tmp.pms
        X
OpenVPN key_source2.client.pre_master
```

它们只是名称相似。

---

### A.16.3 OpenVPN Key Method 2 材料如何交换

#### 源码位置

**【OpenVPN 上游源码确认】**

```text
src/openvpn/ssl.c:1678-1705
    key_source2_randomize_write()

src/openvpn/ssl.c:1709-1735
    key_source2_read()

src/openvpn/ssl.c:2091-2095
    发送本端 key source material

src/openvpn/ssl.c:2255-2261
    接收对端 key source material
```

客户端生成：

```text
pre_master[48]
random1[32]
random2[32]
```

服务端生成自己的：

```text
random1[32]
random2[32]
```

这些数据作为 OpenVPN 控制消息进入 `ssl_bio`，因此在网络上传输时受到 TLS/TLCP Record 保护，但它们不是 Tongsuo TLCP Key Block 的字段。

---

## A.17 OpenVPN 数据通道的两条 KDF 路径

### A.17.1 路径一：TLS Exporter

#### 源码位置

**【OpenVPN 上游源码确认】**

```text
src/openvpn/ssl.c:1421-1432
    generate_key_expansion_tls_export()

src/openvpn/ssl.c:1479-1528
    generate_key_expansion()
```

当：

```text
CO_USE_TLS_KEY_MATERIAL_EXPORT
```

成立时：

```text
SSL session
  ↓
SSL_export_keying_material(EXPORT_KEY_DATA_LABEL)
  ↓
key2->keys[0]
key2->keys[1]
  ↓
init_key_contexts()
```

此时 Data Channel key material 与当前 TLS/TLCP session 的 Master Secret 通过 exporter 建立密码学联系。

但是 NTLS 公共 exporter 门禁未解决时，这条路径会失败。

---

### A.17.2 路径二：OpenVPN legacy PRF

#### 源码位置

**【OpenVPN 上游源码确认】**

```text
src/openvpn/ssl.c:1435-1471
    generate_key_expansion_openvpn_prf()
```

输入不是 Tongsuo TLCP PMS，而是：

```text
key_source2.client.pre_master
client.random1
server.random1
client.random2
server.random2
client session_id
server session_id
```

第一步：

```text
OpenVPN pre_master + random1
    ↓
openvpn_PRF("OpenVPN master secret")
    ↓
OpenVPN-local master[48]
```

第二步：

```text
OpenVPN-local master + random2 + session IDs
    ↓
openvpn_PRF("OpenVPN key expansion")
    ↓
key2
```

随后：

```text
init_key_contexts()
```

建立 OpenVPN Data Channel 的加解密上下文。

#### 关键边界

因此当前架构中至少存在三个容易被统称为“master/key”的不同对象：

```text
1. TLCP PMS
2. TLCP Master Secret
3. OpenVPN legacy PRF 的 master[48]
```

其中第 3 个只存在于 OpenVPN 数据通道 legacy KDF 路径，与 Tongsuo `SSL_SESSION::master_key` 不是同一个字段。

---

## A.18 Exporter 能力如何影响 OpenVPN 的 Data Channel KDF 选择

### A.18.1 peer capability 协商

#### 源码位置

**【OpenVPN 上游源码确认】**

```text
src/openvpn/ssl_ncp.c:439-451
```

对端声明：

```text
IV_PROTO_TLS_KEY_EXPORT
```

后，OpenVPN 设置：

```text
CO_USE_TLS_KEY_MATERIAL_EXPORT
```

之后 `generate_key_expansion()` 才选择 exporter 路径。

因此 exporter 不是“OpenVPN 单边想用就用”，它同时受能力协商影响。

---

### A.18.2 当前 PoC 为什么关闭 `IV_PROTO_TLS_KEY_EXPORT`

#### 源码位置

**【本地适配参考】**

```text
src/openvpn/ssl.c:1970-1985
```

PoC 在 NTLS 模式下不宣告：

```text
IV_PROTO_TLS_KEY_EXPORT
```

目的在于避免双方协商选择 exporter 后，最终调用 `SSL_export_keying_material()` 又因为 Tongsuo 公共 API 的 NTLS 版本门禁失败。

结果就是：

```text
TLCP control channel
    ↓ 成功
Exporter capability
    ↓ 不协商
OpenVPN data key KDF
    ↓ legacy OpenVPN PRF
```

这正是“控制通道国密化”和“业务数据通道完整国密化”之间的边界。

---

## A.19 Data Channel Cipher 也不是由 `ECC-SM2-SM4-CBC-SM3` 自动决定

### A.19.1 OpenVPN 自己选择数据通道 cipher

#### 源码位置

**【OpenVPN 上游源码确认】**

```text
src/openvpn/ssl.c:1575-1658
    tls_session_update_crypto_params_do_work()
    tls_session_update_crypto_params()
```

其中通过 OpenVPN 的：

```text
options->ciphername
NCP / IV_CIPHERS
```

初始化：

```text
session->opt->key_type
```

再由：

```text
init_key_contexts()
```

把 `key2` 安装到 Data Channel cipher context。

因此：

```text
TLCP Cipher Suite:
ECC-SM2-SM4-CBC-SM3
```

只决定：

```text
Tongsuo TLS/TLCP Record protection
```

它不会自动把 OpenVPN：

```text
--data-ciphers
NCP选择
key_type.cipher
DCO cipher
```

改成 SM4。

#### 公司文档必须采用的结论

> **抓包看到 TLCP `0xe013` 只能证明 TLS/TLCP 控制通道选择了该套件；不能据此宣称 OpenVPN 业务数据通道使用 SM4。**

业务数据通道要单独证明：

```text
NCP协商算法
→ key_type
→ key2
→ 用户态 crypto context / DCO
→ 实际 P_DATA 报文
```

---

## A.20 完整的“谁写、谁读”对象生命周期

下面这张图建议作为后续代码评审的主图。

```text
[OpenVPN config]
cert / key
TLCP SIGN cert/key       （正式改造候选）
TLCP ENC  cert/key
        │
        ▼
[OpenVPN ssl backend]
tls_ctx_* / certificate provider
        │
        ▼
[Tongsuo SSL_CTX::cert]
pkeys[SM2_SIGN]
pkeys[SM2_ENC]
        │
        │ SSL_new()
        ▼
[Tongsuo SSL::cert]
pkeys[SM2_SIGN]
pkeys[SM2_ENC]
        │
        │ tls_choose_sigalg_ntls()
        ▼
[s->s3.tmp]
sign_cert ─────→ SIGN slot
enc_cert  ─────→ ENC slot
        │
        ├────────────── Certificate
        │                 SIGN cert + ENC cert
        │
        ├────────────── ServerKeyExchange
        │                 SIGN private key
        │                 signs Randoms + ENC cert
        │
        └────────────── ClientKeyExchange
                          client reads ENC cert pubkey
                          server reads ENC private key
                                   │
                                   ▼
                                  PMS
                                   │
                                   ▼
                            Master Secret
                                   │
                                   ▼
                               Key Block
                   ┌───────────────┼───────────────┐
                   ▼               ▼               ▼
                  MAC              key              IV
                   │               │               │
                   └───────────────┼───────────────┘
                                   ▼
                             TLCP Record
                                   │
                                   ▼
                        OpenVPN control plaintext
                                   │
                  ┌────────────────┴─────────────────┐
                  ▼                                  ▼
          SSL/TLCP Exporter                  OpenVPN key_source2
                  │                                  │
                  ▼                                  ▼
                key2                       OpenVPN legacy PRF
                  │                                  │
                  └────────────────┬─────────────────┘
                                   ▼
                          OpenVPN Data Channel
```

---

## A.21 每一层的关键改造点判断

这一节不做大表格，只按源码层给出结论。

### A.21.1 OpenVPN 配置层

**上游现状**：只有普通 `cert/private-key` 单身份语义。  
**候选改造**：增加 TLCP protocol mode 与 SIGN/ENC 双身份表达；同时兼容 PEM、inline、URI、PKCS#11/HSM。  
**不建议**：用环境变量作为最终产品配置接口。  
**证据**：【OpenVPN 上游源码确认】【本地适配参考】【改造判断】。

### A.21.2 OpenVPN TLS backend

**上游现状**：`tls_ctx_server_new/client_new()` 创建普通 TLS method；证书加载最终进入标准 `SSL_CTX_use_certificate/PrivateKey`。  
**候选改造**：仅在 Tongsuo/TLCP 模式下选择 NTLS method、启用 NTLS、调用双证书 API；普通 TLS 路径保持不变。  
**不建议**：在 `ssl.c` 上层重写 TLCP 握手报文。  
**证据**：【OpenVPN 上游源码确认】【Tongsuo 上游源码确认】【改造判断】。

### A.21.3 Tongsuo 双证书层

**上游现状**：已经存在 `SSL_PKEY_SM2_SIGN/ENC`、双证书 setter、NTLS Certificate/SKE/CKE 消费者。  
**候选改造**：OpenVPN 接入一般不需要重写此层；除非发现互通缺陷、标准差异或 HSM/provider 接口问题。  
**重点审查**：角色槽位、证书 KeyUsage、pair check、HSM key handle 是否保持 SIGN/ENC 分离。  
**证据**：【Tongsuo 上游源码确认】。

### A.21.4 PMS / Master Secret / Key Block

**上游现状**：NTLS 方法表复用 `tls1_generate_master_secret/tls1_setup_key_block/tls1_change_cipher_state`，suite 通过 `TLS1_PRF_SM3` 选择 SM3 PRF。  
**候选改造**：正常接入不应重新实现 KDF；应验证目标 suite 与 provider 能正确提供 SM3/SM4。  
**不建议**：在 OpenVPN 复制 PMS 或 Master Secret。  
**证据**：【Tongsuo 上游源码确认】【改造判断】。

### A.21.5 Exporter

**上游现状**：NTLS 方法表有 exporter，但公共 wrapper 的 TLS 版本门禁阻断。  
**候选改造**：优先修正接口分派/版本边界，并建立 exporter 正负测试。  
**重点**：必须定义失败和回退策略；禁止静默降级后仍把结果描述为“完整国密闭环”。  
**证据**：【Tongsuo 上游源码确认】【改造判断】。

### A.21.6 OpenVPN Data Channel

**上游现状**：Data Channel 有自己的 NCP、`key_type`、KDF 和 cipher context。  
**候选改造**：如果产品要求“业务数据通道国密化”，必须独立解决 SM4 Data Cipher、认证/AEAD 形式、能力协商、DCO/内核支持以及 key lifecycle。  
**不应混淆**：TLCP Record 的 SM4 不能替代 OpenVPN P_DATA 层的 SM4。  
**证据**：【OpenVPN 上游源码确认】【协议行为推导】【改造判断】。

---

## A.22 失败路径与可观测现象

### A.22.1 配置/文件阶段

```text
SIGN/ENC文件不存在
→ *_use_*_file() 返回失败
→ SSL_CTX 初始化失败
→ 尚未进入网络握手
```

**验证方式**：启动日志、错误栈；抓包应看不到完整 TLCP ClientHello/ServerHello 之后的正常推进。

### A.22.2 SIGN pair 不匹配

```text
ssl_set_pkey_idx(SIGN)
→ X509_check_private_key() 失败
→ setter 返回 0
→ 初始化失败
```

**验证方式**：负面测试故意交换 SIGN 私钥。

### A.22.3 ENC pair 不匹配

同上，但发生在 `SSL_PKEY_SM2_ENC`。

**验证方式**：故意交换 ENC 私钥；确保不会静默用 SIGN 私钥代替。

### A.22.4 Certificate 已发送，但 SKE 签名失败

```text
SIGN私钥存在
→ EVP_DigestSignInit/Sign 失败
→ tls_construct_server_key_exchange_ntls() 失败
```

可能原因：provider 不支持签名、HSM不可用、SM2 ID/参数失败等。

### A.22.5 ClientKeyExchange PMS 解密失败

```text
收到 CKE
→ ENC private key
→ EVP_PKEY_decrypt() 失败
→ SSL_R_DECRYPTION_FAILED
```

此时不能归因于 SM4 Record 或 SM3 PRF，因为流程还没建立出共同 Master Secret。

### A.22.6 Master Secret / Finished 不一致

```text
PMS 或 Random/PRF 语义不一致
→ Master Secret 不一致
→ Finished 校验失败
```

这是 KDF 闭环失败的重要症状。

### A.22.7 Exporter 失败

```text
TLCP握手已完成
→ OpenVPN 调 SSL_export_keying_material()
→ 公共版本门禁返回失败
→ OpenVPN generate_key_expansion_tls_export() 失败
```

这属于 **TLS/TLCP 与 OpenVPN Data Channel 的接口边界**，不是 ServerKeyExchange/PMS bug。

---

## A.23 验证矩阵：证明“改造真的生效”需要看到什么

### A.23.1 静态源码证据

必须证明：

```text
OpenVPN配置
→ 双证书API
→ pkeys[SIGN/ENC]
→ SSL_new复制
→ 状态机消费者
→ EVP签名/加密/解密
→ KDF
→ Record cipher/MAC
```

### A.23.2 初始化运行证据

建议日志/断点确认：

```text
NTLS method selected
SIGN pair loaded
ENC pair loaded
SSL_new succeeded
```

不要打印私钥或真实密钥内容。

### A.23.3 握手抓包证据

至少确认：

```text
ClientHello / ServerHello
TLCP version
目标 cipher suite
Certificate 中双证书顺序
ServerKeyExchange
ClientKeyExchange
ChangeCipherSpec / Finished
```

### A.23.4 密码消费者证据

调试版本可在函数入口下断点确认：

```text
tls_construct_server_key_exchange_ntls()
EVP_DigestSign*

tls_construct_cke_pms_ntls()
EVP_PKEY_encrypt*

tls_process_cke_pms_ntls()
EVP_PKEY_decrypt*

tls1_generate_master_secret()
tls1_setup_key_block()
tls1_change_cipher_state()
```

### A.23.5 Exporter 证据

确认：

```text
SSL_export_keying_material()
是否进入 method->ssl3_enc->export_keying_material
```

这是判断版本门禁是否解决的最直接断点。

### A.23.6 Data Channel 证据

必须独立确认：

```text
IV_CIPHERS / NCP 结果
CO_USE_TLS_KEY_MATERIAL_EXPORT 是否置位
实际走 exporter 还是 legacy PRF
session->opt->key_type.cipher
init_key_contexts / DCO安装结果
实际 P_DATA 报文
```

只有这一组闭环后，才能描述 OpenVPN 业务数据通道的密码算法状态。

---

## A.24 推荐源码导航顺序

### A.24.1 OpenVPN v2.7.4 上游

```bash
rg -n 'init_ssl\(' src/openvpn/ssl.c
rg -n 'tls_ctx_server_new|tls_ctx_client_new' src/openvpn/ssl_openssl.c
rg -n 'tls_ctx_load_cert_file|tls_ctx_load_priv_file' src/openvpn/ssl_openssl.c
rg -n 'key_state_ssl_init' src/openvpn/ssl_openssl.c
rg -n 'key_state_export_keying_material' src/openvpn/ssl_openssl.c

rg -n 'generate_key_expansion_tls_export|generate_key_expansion_openvpn_prf' src/openvpn/ssl.c
rg -n 'tls_session_generate_data_channel_keys|init_key_contexts' src/openvpn/ssl.c
rg -n 'key_source2_randomize_write|key_source2_read' src/openvpn/ssl.c
rg -n 'IV_PROTO_TLS_KEY_EXPORT|CO_USE_TLS_KEY_MATERIAL_EXPORT' src/openvpn
```

### A.24.2 Tongsuo 8.4.0

先追双证书定义和写入：

```bash
rg -n 'SSL_PKEY_SM2_SIGN|SSL_PKEY_SM2_ENC' ssl/ssl_local.h
rg -n 'SSL_CTX_use_(sign|enc)_(certificate|PrivateKey)' ssl/ssl_rsa.c
rg -n 'ssl_set_cert_idx|ssl_set_pkey_idx' ssl/ssl_rsa.c
rg -n 'SSL_CTX_check_private_key' ssl/ssl_lib.c
```

再追 `SSL_CTX → SSL`：

```bash
rg -n '^SSL \*SSL_new|ssl_cert_dup' ssl/ssl_lib.c ssl/ssl_cert.c
```

再追握手消费者：

```bash
rg -n 'tls_choose_sigalg_ntls' ssl/t1_lib.c
rg -n 'tls_construct_server_certificate_ntls' ssl/statem_ntls
rg -n 'tls_construct_server_key_exchange_ntls' ssl/statem_ntls
rg -n 'tls_construct_cke_pms_ntls' ssl/statem_ntls
rg -n 'tls_process_cke_pms_ntls' ssl/statem_ntls
```

最后追密钥和记录层：

```bash
rg -n 'ssl_generate_master_secret' ssl/s3_lib.c
rg -n 'tls1_PRF|tls1_generate_master_secret|tls1_setup_key_block|tls1_change_cipher_state' ssl/t1_enc.c
rg -n 'NTLS_enc_data' ssl/t1_lib.c
rg -n 'SSL_export_keying_material' ssl/ssl_lib.c
rg -n 'ssl3_enc\(|tls1_mac\(' ssl/record
```

推荐坚持：

```text
定义
→ 写入
→ 对象复制
→ 状态机选择
→ 消费者
→ 密钥派生
→ 最终数据面
```

不要按文件从第一行顺序阅读整个 Tongsuo。

---

## A.25 本附录最终结论

基于 OpenVPN v2.7.4 与 Tongsuo 8.4.0 的源码结构，可以把 OpenVPN→Tongsuo TLCP 双证书和密钥生命周期归纳为以下闭环：

```text
OpenVPN 上游单证书配置模型
    ↓ 需要上层扩展
SIGN / ENC 双身份
    ↓
Tongsuo SSL_CTX::cert
    ↓
pkeys[SM2_SIGN] / pkeys[SM2_ENC]
    ↓ SSL_new + ssl_cert_dup
SSL::cert
    ↓
tls_choose_sigalg_ntls
    ↓
Certificate 发送 SIGN + ENC
    ↓
ServerKeyExchange：SIGN私钥绑定ENC证书
    ↓
ClientKeyExchange：ENC公钥加密PMS / ENC私钥解密PMS
    ↓
SM3 PRF
    ↓
TLCP Master Secret
    ↓
SM3 PRF Key Block
    ↓
HMAC-SM3 + SM4-CBC Record
```

但是在 OpenVPN 边界之后还存在第二条独立链：

```text
TLS/TLCP session
    ↓
Exporter（当前 NTLS 公共API存在版本门禁）
或
OpenVPN legacy key_source2 PRF
    ↓
OpenVPN key2
    ↓
OpenVPN Data Channel cipher
```

因此公司技术文档在描述“国密化完成度”时必须使用分层措辞：

```text
可以分别证明：
1. OpenVPN 控制通道是否进入 Tongsuo TLCP；
2. TLCP 是否使用 SIGN/ENC 双证书；
3. TLCP 是否通过静态 SM2 建立 PMS；
4. TLCP 是否以 SM3 PRF 派生 Master Secret/Key Block；
5. TLCP Record 是否使用 SM4-CBC + HMAC-SM3；
6. OpenVPN Data Channel 是否使用与 TLS/TLCP session 绑定的 exporter；
7. OpenVPN Data Channel cipher 本身是否国密化。
```

上述 1~5 成立，仍不能代替 6~7 的证明。

这也是后续所有 OpenVPN TLCP/HSM/PQC 改造评审应保持的核心边界。

---

### A.26 源码位置快速索引

仅作为导航，详细语义以上文为准。

```text
OpenVPN v2.7.4 上游：
  src/openvpn/ssl_openssl.c:97-129      tls_ctx_server_new/client_new
  src/openvpn/ssl_openssl.c:150-165     key_state_export_keying_material
  src/openvpn/ssl_openssl.c:1192-1308   单证书 cert/key 加载
  src/openvpn/ssl_openssl.c:2079-2114   key_state_ssl_init

OpenVPN 当前 PoC参考：
  src/openvpn/ssl_openssl.c:82-132      Tongsuo/TLCP bridge + 双证书加载
  src/openvpn/ssl_openssl.c:1474-1478   双证书加载触发点
  src/openvpn/ssl.c:1970-1985           NTLS下不宣告TLS exporter能力

OpenVPN Data Channel（当前2.7.4源码快照，上游逻辑）：
  src/openvpn/ssl_common.h:120-142      key_source / key_source2
  src/openvpn/ssl.c:1421-1471           exporter / legacy PRF
  src/openvpn/ssl.c:1479-1528           generate_key_expansion
  src/openvpn/ssl.c:1543-1571           tls_session_generate_data_channel_keys
  src/openvpn/ssl.c:1678-1735           key_source2 write/read
  src/openvpn/ssl_ncp.c:439-451         exporter能力协商

Tongsuo 8.4.0：
  ssl/ssl_local.h:385-389               SM2 SIGN/ENC槽位
  ssl/ssl_local.h:2094-2171             CERT_PKEY / CERT
  ssl/ssl_rsa.c:1242-1310               双证书底层setter
  ssl/ssl_rsa.c:1312-1595               SIGN/ENC公开装载接口
  ssl/ssl_lib.c:1705-1717               SSL_CTX_check_private_key
  ssl/ssl_lib.c:689-754                 SSL_new
  ssl/ssl_cert.c:76-114                 ssl_cert_dup
  ssl/t1_lib.c:999-1003                 NTLS SM2 sigalg
  ssl/t1_lib.c:3220-3256                tls_choose_sigalg_ntls
  ssl/statem_ntls/ntls_statem_lib.c:722-765   双证书写入Certificate
  ssl/statem_ntls/ntls_statem_srvr.c:2225-2240 server Certificate
  ssl/statem_ntls/ntls_statem_srvr.c:1630-1792 ServerKeyExchange
  ssl/statem_ntls/ntls_statem_clnt.c:1893-1975 ClientKeyExchange PMS加密
  ssl/statem_ntls/ntls_statem_srvr.c:1827-1942 PMS解密
  ssl/s3_lib.c:3895-3958                ssl_generate_master_secret
  ssl/t1_lib.c:104-120                  NTLS_enc_data
  ssl/t1_enc.c:25-99                    PRF / Key Block PRF
  ssl/t1_enc.c:493-575                  setup_key_block
  ssl/t1_enc.c:604-664                  generate_master_secret
  ssl/t1_enc.c:186-488                  change_cipher_state / key切分
  ssl/t1_enc.c:667-735                  tls1_export_keying_material
  ssl/ssl_lib.c:3209-3220               SSL_export_keying_material公共门禁
  ssl/ssl_ciph.c:49-52                  SSL_SM4 → SM4-CBC
  ssl/record/ssl3_record.c:855-...       Record cipher
  ssl/record/ssl3_record.c:1396-...      Record MAC
```
