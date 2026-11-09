// 两种游戏盒：尺寸比例和印在盒子上的字。颜色在 style.css 里按 body[data-style] 切换。

// 光盘盒：135 × 170 × 14 mm，半透明蓝色塑料。
export const discStyle = {
  id: 'disc',
  aspect: 135 / 170,
  depth: 14 / 170,
  bandLeft: 'PC',
  bandRight: 'gamelib',
  isCard: false,
};

// 卡带盒：105 × 170 × 11 mm，红色塑料，白色书脊。
export const cardStyle = {
  id: 'card',
  aspect: 105 / 170,
  depth: 11 / 170,
  bandLeft: 'PC',
  bandRight: 'GAME CARD',
  isCard: true,
};

export const styleById = (id) => (id === 'card' ? cardStyle : discStyle);

// 卡带：21 × 31 mm，竖着放。
export const CARD_ASPECT = 21 / 31;
