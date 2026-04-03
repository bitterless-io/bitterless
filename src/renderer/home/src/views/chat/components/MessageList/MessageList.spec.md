# MessageList 开发说明

## 列表上下拉加载更多的机制
列表产生滚动的情况
- 用户手动滚动
- 新消息进入,或流式渲染时如果不处于isBrowsingHistory状态,就会不停的滚动到底部
- 搜索消息,点击历史记录,如果消息已经在列表中,需要scroll到指定message item,message item要对应id用message.id


messageList.service.ts 下新增状态字段用于控制消息列表的交互
### 状态字段:isFirstPageLoaded
标明会话的第一页消息是否加载,如以下情况:

触发时机:
- 新会话
- 打开一个历史聊天记录

### 状态字段:isBrowsingHistory
触发时机:
- 用户向上滚动超过60px.


### 上一个动作:lastAction
- idle:啥也没干
- send:发消息的动作
- scrollToTop
- scrollToBottom

##  滚动到底部的情况
- 人工触发
- 自动滚到底,消息列表长度发生变化时判断上个动作,如果是send||idle/isFirstPageLoaded:true/且不是isBrowsingHistory
- 自动滚到底,最新消息chunk进入时判断上个动作,如果是send||idle/isFirstPageLoaded:true/且不是isBrowsingHistory

## 加载消息的情况

- 创建新会话,isFirstPageLoaded默认true,无需尝试加载历史消息
- 点开历史会话,isFirstPageLoaded为,false,加载第一页,isFirstPageLoaded改为true
- 向上滚动时,且滚动到顶部 ,lastAction 设为 scrollToTop 触发加载历史消息
- 向下滚动,且滚动到底部,且isFirstPageLoaded:false(通过历史消息进入会话可能会出现这种情况),需要加载更近的一页消息,如果消息少于pageSize(20),isFirstPageLoaded=true

注意,通过搜索历史消息进入,会查询搜索目标消息上下各10条数据,如果下半部分少于10条,isFirstPageLoaded = true;
点开会话查询到的消息少于20条isFirstPageLoaded = true;
发送消息时如果isFirstPageLoaded 为false需要查询 第一页数据,查询完成后isFirstPageLoaded = true;
另外如果是搜索的方式进入,然后发送了一条新消息,此时消息列表消息可能是不连贯的,即搜索的消息最后一条,和第一页的第一条消息中间还有别的消息,
为了方便处理isFirstPageLoaded 为false情况发送消息后,只保留第一页数据,方便后续连贯.
也可能会有交集,处理方式也是这样
