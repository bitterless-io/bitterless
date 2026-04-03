import successSound from '@renderer/common/assets/sound/success.wav';

const successAudio = new Audio(successSound);

export const playSuccessSound = () => {
  successAudio.currentTime = 0;
  successAudio.play().catch(() => {});
};
