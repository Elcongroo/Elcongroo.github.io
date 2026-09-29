---
title: '单虚拟机 IPsec 实验：协商、XFRM 与 ESP 的对应关系'
description: '9 月 23 日单虚拟机实验摘要：连接加载、双向 XFRM、ESP SPI 与 proposal 不匹配失败。原始记录暂不公开。'
date: 2026-09-29
updated: 2026-09-29
occurred: 2026-09-23
number: LAB-002
purpose: 将 IKE 协商结果、XFRM state/policy 与实际业务流量对上。
environment: ['四个 Linux 网络命名空间；两台模拟网关与两侧内网', '原实验文档记载 Ubuntu 26.04.1、strongSwan 6.0.4、Linux 7.0.0；未附版本命令原始输出']
result: IKE/CHILD_SA 建立；双向 state 各记录 4 包、336 字节；保存首对 ESP 与 NO_PROPOSAL_CHOSEN 失败日志。原始文件暂不公开。
openQuestions: ['抓包仅覆盖首对 ESP，缺少内层抓包和内核函数跟踪。', '原始记录尚未公开，读者暂不能据本站材料独立复核。']
conclusion: verified
evidenceAccess: private
performedBy: congroo 已确认亲自操作；Codex 本次核对历史材料并整理摘要，未重跑。
article: ikev2-single-vm-lab
evidence: []
---

## 记录范围

这是[单虚拟机实操原稿](/articles/ikev2-single-vm-lab/)对应的一次运行摘要。实验发生在 **2026-09-23**，摘要于 **2026-09-29** 收录本站。本次整理核对了既有材料，没有重跑实验。

**原始日志、XFRM 输出与 PCAP 暂不公开。** 以下结果依据作者保留的运行记录，不是本站已提供的公开证据包；读者目前不能据这些摘要独立复核。

实验使用四个网络命名空间模拟两台网关和两侧内网，在同一内核里建立标准 IKEv2 / PSK 隧道。它不是公司部署拓扑，也不是两个独立系统的互通测试。

## 三条源码链，各自对应什么

| 源码问题 | 既有记录中的观察 | 尚未覆盖 |
| --- | --- | --- |
| [配置 → IKE_SA](/articles/strongswan-config-ike-sa/) | 连接加载成功；日志记录 IKE_SA 建立；双端 SA 为 ESTABLISHED | 没有逐函数调试调用栈 |
| [CHILD_SA → XFRM](/articles/strongswan-child-sa-xfrm/) | 双向 SPI 与 state 一致；policy 保留 out / in / fwd 方向 | 没有 Netlink 消息抓取或安装失败注入 |
| [业务 IP → ESP](/articles/strongswan-ip-packet-esp/) | 4 次 ping 成功；两个方向各 4 包、336 字节；首对 ESP 的 SPI 匹配 | PCAP 未覆盖全部往返；没有内层抓包或内核函数跟踪 |

源码分析使用 strongSwan **6.0.3** 与 Linux **v6.6**。原实验文档记载的运行环境为 strongSwan **6.0.4**、Linux **7.0.0**、Ubuntu **26.04.1**；现有材料没有版本命令原始输出。因此，源码坐标用于解释机制，不能当作该运行版本的函数执行证明。

## 抓包没有覆盖全部四次往返

保存的 PCAP 一共 **12 帧**：第 1—4 帧是 IKE_SA_INIT / IKE_AUTH，第 5—10 帧是 INFORMATIONAL，第 11—12 帧是第一对 ESP。抓包计数日志与此一致。

ping 输出记录了 4 次成功，XFRM 两个方向也各有 4 包、336 字节。但不能把这些计数改写成“抓包里有 8 个 ESP 包”，也不能据这份 PCAP 描述 ESP 序列号连续递增。抓包覆盖不足的原因没有从现有材料中确定。

两端 SA、XFRM 与抓包的方向和 SPI 相互吻合；结合业务 ping 与 state 计数，支持这次业务流量经过了双向 IPsec SA。它不证明国密、PQC、跨厂商互通或性能。

## 一个真实失败：两端 proposal 没有交集

原实验记录：网关 A 使用 `aes256-sha256-modp2048`，网关 B 临时改成 `aes128-sha256-modp2048`。响应方返回 `NO_PROPOSAL_CHOSEN`，发起失败。

这是 **IKE proposal 协商失败**，不能写成 XFRM 安装失败。现有失败日志没有对应的故障 PCAP；恢复配置也不等于重新建立了隧道。

## 作者操作与复核状态

congroo 于 2026-09-29 确认亲自操作过这套实验，包括两端网关、4 次 ping 与 proposal 不匹配测试。这一确认对应本次实验，不扩展为三篇源码文章所有机制均已实测。

本次整理通过已有校验清单核对了运行记录。**公开复核尚不可用，独立环境交叉验证也未完成。** 这两项与作者实际操作是不同的状态。

后续优先补完整抓包、运行版本输出和新一轮复现中的排障笔记。原始材料何时公开，另行决定；这页不会放出尚未提供的下载链接。
