<template>
  <div
    name="trench__sniping__products"
    class="sniping-products"
    :class="{ 'sniping-products--detail': store.mobileDetail }"
  >
    <SnipingProductPane />
    <SnipingProductDetail />
  </div>
</template>

<script setup lang="ts">
import SnipingProductDetail from './SnipingProductDetail.vue';
import SnipingProductPane from './SnipingProductPane.vue';
import { snipingStore as store } from '../../views/sniping/sniping.runtime';
</script>
