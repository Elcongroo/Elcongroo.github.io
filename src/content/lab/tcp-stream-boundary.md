---
title: '一次 recv，不等于一条应用消息'
description: '用同步事件控制两次写入，观察短读与提前 EOF。'
date: 2026-09-29
updated: 2026-09-29
number: LAB-001
purpose: 验证长度前缀与累积读取能否恢复消息，并识别提前 EOF。
environment: [CPython 3.14.4, Linux 7.0.0-34-generic / x86_64, 127.0.0.1 / 临时端口]
result: 正常与提前 EOF 两个用例、15 项断言通过；原始记录中首次正文读取为 8/16 字节。
openQuestions: [长度头截断、多个连续消息与超时恢复尚未覆盖。, 作者本人手工复现尚未验收。]
conclusion: verified
performedBy: Codex 编写并执行；作者本人复现待完成
article: tcp-recv-message-boundary
evidence:
  - label: 原始 JSON
    path: downloads/tcp-stream-lab/evidence/run-03.json
  - label: stderr（空文件）
    path: downloads/tcp-stream-lab/evidence/run-03.stderr.log
  - label: SHA-256 清单
    path: downloads/tcp-stream-lab/SHA256SUMS
---

## 执行记录

执行开始：2026-09-29 03:56:13 UTC。两个用例均成功结束，退出码为 0；标准错误为空。

| 用例 | 第一读 | 后续读取 | 结果 |
| --- | --- | --- | --- |
| 正常 | 8 字节 `cipher-t` | 8 字节 `o-packet` | 收齐并校验 16 字节正文 |
| 提前 EOF | 8 字节 `cipher-t` | 0 字节 | 检测到 `PrematureEOF`，拒绝残缺正文 |

这里保存的是自动实验事实，不是作者本人学习验收。原始 JSON 记录了每次 `recv()` 的请求和返回长度，表格只是摘要。

## 验证范围

实验使用四字节长度头和一个短消息。发送线程等待第一读返回后，才写出后半正文。这种安排用于稳定观察短读，不代表 TCP 的一般分段方式。

没有 PCAP，没有 TLS/VPN 握手，也没有性能测试。原始记录里的执行时间不能作为性能基准。

## 下一次可以补什么

先增加长度头截断的负向用例，再考虑连续多条消息。当前两个用例仍是独立基线，不因未来计划存在而扩大验证范围。
