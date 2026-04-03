preload中的sqlite主要的功能有:
- 用户通过其它进程向sqlite进程发送对话消息
- sqlite存放消息到sqlite数据库和qdrant中
- sqlite进程负责将联通和llm的通信,向其他进程回复消息

注意事项:
 - 消息有多重来源如:本地主窗口聊天,wechat,telegram等

最终目的:
- 对话历史回溯
- 可以将sqlite中用户和ai的消息形成多层次的记忆短期记忆(消息,摘要),长期记忆qdrant
