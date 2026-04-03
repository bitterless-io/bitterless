<script setup lang="ts">
import { rigchatStore } from '../../store/rigchat.store'
</script>

<template>
  <div class="rigchat-panel">
    <div class="rigchat-panel__header">
      <a-tag v-if="rigchatStore.loggedIn" color="green">已登录: {{ rigchatStore.nickName }}</a-tag>
      <a-tag v-else color="blue">Rigchat Bot</a-tag>
      <p v-if="rigchatStore.error" class="rigchat-panel__error">{{ rigchatStore.error }}</p>
    </div>

    <div v-if="rigchatStore.qrcodeUrl && !rigchatStore.loggedIn" class="rigchat-panel__qrcode">
      <p>请使用微信扫描二维码登录</p>
      <img :src="rigchatStore.qrcodeUrl" alt="QR Code" />
    </div>

    <div v-if="rigchatStore.loggedIn" class="rigchat-panel__messages">
      <div
        v-for="(msg, idx) in rigchatStore.messages"
        :key="idx"
        class="rigchat-panel__message-item"
      >
        <span class="rigchat-panel__message-time">{{ msg.time }}</span>
        <span class="rigchat-panel__message-talker">{{ msg.talker }}</span>
        <img
          v-if="msg.imagePath"
          class="rigchat-panel__message-image"
          :src="'file://' + msg.imagePath"
          alt="image"
        />
        <span v-else class="rigchat-panel__message-content">{{ msg.content }}</span>
      </div>
    </div>
  </div>
</template>

<style lang="less">
@import './RigchatPanel.less';
</style>
