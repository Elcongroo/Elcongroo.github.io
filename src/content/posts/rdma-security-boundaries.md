---
title: "RDMA 为什么是安全通信栈的一条支线"
description: "从 MR、QP、CQ 和远端访问权限，讨论 RDMA 与 VPN、密码服务的边界。"
date: "2026-09-29"
updated: "2026-09-29"
category: "performance"
modules: ["rdma", "fast-path", "provider"]
editorial: "research"
tags: ["系统栈补充", "rdma", "fast-path", "provider"]
kind: "补充研究稿"
minutes: 12
series: "系统栈：接口与边界"
seriesOrder: 5
difficulty: "专题研究"
prerequisites: ["区分管理面、控制面与数据面", "理解 IKE / TLS 握手和业务数据通道的分工"]
environment: ["文献研究与设计推演；没有执行文中的验证方案"]
software: ["rdma-core libibverbs 官方手册（2026-09-29 查阅）", "未固定硬件、固件或发行版；未做 RDMA 实验"]
conclusion: "public"
realVerified: false
verificationActor: "AI 协助整理公开标准与官方文档；待 congroo 审阅，不作为原稿结论或实验结果"
changes: [{"date": "2026-09-29", "note": "新增博客补充研究稿；列出公开依据、设计推演和待验证项，未回写原文档库。"}]
---

## 它改变的是访问内存和传输的方式

在安全通信系统中，RDMA 可能出现在计算节点、密码服务节点或设备协同的内部通信里。它并不是 IKE、TLS 或 ESP 后面必然要接上的“更高级网络层”。是否需要它，首先取决于业务的请求大小、并发、尾时延目标与部署环境。

本文只建立接口和安全边界的研究坐标。没有 RDMA 硬件实验，也没有密码服务集群部署结果。

## 四个对象足够开始阅读

| 对象 | 先抓住的含义 | 不要直接等同于 |
| --- | --- | --- |
| MR / Memory Region | 注册给设备访问的内存区域与权限 | 任意进程内存都可远程访问 |
| QP / Queue Pair | 关联的发送与接收工作队列 | 一个 TLS 安全会话 |
| CQ / Completion Queue | 工作完成通知的来源 | 对端业务处理完成 |
| PD / Protection Domain | 限定相关资源可组合的保护域 | 完整的用户身份与授权系统 |

`ibv_reg_mr()` 注册内存并返回本地与远端访问使用的 key；远端 RDMA 操作需要相应地址、key 和访问权限。这里的 key 是访问控制接口的一部分，不能仅凭名字就把它当成密码学会话密钥。[rdma-core：ibv_reg_mr](https://github.com/linux-rdma/rdma-core/blob/master/libibverbs/man/ibv_reg_mr.3)

创建 QP 与提交工作请求的接口分别见 [ibv_create_qp](https://github.com/linux-rdma/rdma-core/blob/master/libibverbs/man/ibv_create_qp.3) 和 [ibv_post_send](https://github.com/linux-rdma/rdma-core/blob/master/libibverbs/man/ibv_post_send.3)。这些接口描述传输操作，不替应用定义“请求成功”的业务语义。

## 把连接控制和数据访问拆开

下面是**候选应用结构**，不是任何现有产品的架构。

```mermaid
flowchart LR
  A["身份认证与授权"] --> B["交换连接参数<br/>约束可访问资源"]
  B --> C["建立 QP / 注册 MR"]
  C --> D["提交工作请求 / 观察 CQ"]
  D --> E["业务确认与资源回收"]
  A -. "撤销权限" .-> E
```

即使在某条 TCP 控制连接上用了 TLS，也不能由此推断独立的 RDMA 数据流已被 TLS 记录层保护。需要分别确认数据到底走哪个接口、经过哪个保护机制，以及保护是否在目标网卡和网络上生效。

这与 VPN 中“控制面已认证，不等于业务数据面已经按预期保护”是同一种边界问题。参照[IPsec 数据面](/articles/linux-xfrm-esp/)，可以用相似方法检查状态、消费者和实际流量，但不能假设两条数据路径相同。

## 如果连接的是密码服务，先问五件事

1. 传输的是待签名摘要、明文、密文还是密钥材料？不同数据的保护要求不同。
2. 调用者如何获得访问指定资源的权限，谁发放、回收和更新访问参数？
3. 内存何时可重用？超时是否意味着设备已经不再访问这块内存？
4. 一个 completion 对应传输完成、远端内存可见，还是业务处理结束？必须按所用操作和应用协议分别判断。
5. 设备或连接失败后，如何识别已完成、未完成与完成状态未知的请求，避免盲目重试产生重复操作？

这些问题使 RDMA 与[密码抽象接口](/articles/crypto-provider-kdf-map/)发生联系：两者都需要明确资源所有权、异步完成和失败后的状态。它们不要求所有密码设备都支持 RDMA。

## 验证方案应从小对象开始

**尚未执行的代表性实验**：先在独立环境中记录网卡、驱动、固件、rdma-core 版本与传输类型。完成一条发送/接收路径，保存资源创建、工作请求和 completion 的对应关系。再增加一种 RDMA 读或写操作，单独解释 MR 权限和生命周期。

随后做边界测试：不匹配的访问权限、连接中止、远端资源撤销、completion 错误、请求超时后重试。预期不是所有路径都成功，而是错误能定位到具体请求，资源不会被提前复用。

性能对照应使用相同的业务协议和工作量，同时比较 CPU 占用、吞吐与尾时延。不能把一个空负载的 verbs 微基准，与包含认证、排队和真实密码运算的完整 RPC 直接比较。

## 当前结论

RDMA 值得作为高性能系统的一条独立研究线保留，但现在没有依据把它写成 VPN 的默认演进方向。优先补齐 Linux 网络、性能画像和异步资源管理，之后再由测量决定是否进入具体 RDMA 场景。
