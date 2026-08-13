import { Platform, StyleSheet, Text, View } from 'react-native';
import { createElement } from 'react';
import { colors } from '../theme/colors';
import type { CategoryUnderstanding } from '../types/analysis';

type Props = {
  categories: CategoryUnderstanding[];
  size?: number;
};

function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

export function CategoryRadarChart({ categories, size = 260 }: Props) {
  if (categories.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>カテゴリマスタがまだありません</Text>
      </View>
    );
  }

  if (Platform.OS === 'web') {
    const cx = size / 2;
    const cy = size / 2;
    const maxR = size * 0.34;
    const n = categories.length;
    const levels = [0.25, 0.5, 0.75, 1];

    const gridPolys = levels.map((lv) =>
      categories
        .map((_, i) => {
          const p = polar(cx, cy, maxR * lv, (360 / n) * i);
          return `${p.x},${p.y}`;
        })
        .join(' '),
    );

    const valuePoints = categories.map((cat, i) => {
      const rate = cat.rate == null ? 0 : Math.max(0, Math.min(100, cat.rate)) / 100;
      return polar(cx, cy, maxR * rate, (360 / n) * i);
    });
    const valuePoly = valuePoints.map((p) => `${p.x},${p.y}`).join(' ');

    const children = [
      ...gridPolys.map((points, idx) =>
        createElement('polygon', {
          key: `g-${idx}`,
          points,
          fill: 'none',
          stroke: colors.line,
          strokeWidth: 1,
        }),
      ),
      ...categories.map((_, i) => {
        const p = polar(cx, cy, maxR, (360 / n) * i);
        return createElement('line', {
          key: `a-${i}`,
          x1: cx,
          y1: cy,
          x2: p.x,
          y2: p.y,
          stroke: colors.line,
          strokeWidth: 1,
        });
      }),
      createElement('polygon', {
        key: 'value',
        points: valuePoly,
        fill: 'rgba(14, 124, 123, 0.28)',
        stroke: colors.accent,
        strokeWidth: 2,
      }),
      ...valuePoints.map((p, i) =>
        createElement('circle', {
          key: `d-${i}`,
          cx: p.x,
          cy: p.y,
          r: 3.5,
          fill:
            categories[i]?.rate == null ? colors.muted : colors.accentDeep,
        }),
      ),
      ...categories.map((cat, i) => {
        const p = polar(cx, cy, maxR + 22, (360 / n) * i);
        const label =
          cat.rate == null ? `${cat.name}\n未計測` : `${cat.name}\n${cat.rate}%`;
        return createElement(
          'text',
          {
            key: `t-${i}`,
            x: p.x,
            y: p.y,
            fill: colors.inkSoft,
            fontSize: 10,
            fontFamily: 'Noto Sans JP, sans-serif',
            textAnchor: 'middle',
            dominantBaseline: 'middle',
          },
          label,
        );
      }),
    ];

    return createElement(
      'svg',
      {
        width: size,
        height: size,
        viewBox: `0 0 ${size} ${size}`,
        style: { alignSelf: 'center' },
      },
      ...children,
    );
  }

  return (
    <View style={styles.bars}>
      {categories.map((cat) => (
        <View key={cat.categoryId} style={styles.barRow}>
          <Text style={styles.barLabel} numberOfLines={1}>
            {cat.name}
          </Text>
          <View style={styles.barTrack}>
            <View
              style={[
                styles.barFill,
                {
                  width: `${cat.rate ?? 0}%`,
                  backgroundColor:
                    cat.rate == null ? colors.line : colors.accent,
                },
              ]}
            />
          </View>
          <Text style={styles.barValue}>
            {cat.rate == null ? '未計測' : `${cat.rate}%`}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  emptyText: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 13,
    color: colors.muted,
  },
  bars: {
    gap: 8,
    paddingVertical: 8,
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  barLabel: {
    width: 88,
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 12,
    color: colors.inkSoft,
  },
  barTrack: {
    flex: 1,
    height: 10,
    borderRadius: 999,
    backgroundColor: colors.mist,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 999,
  },
  barValue: {
    width: 52,
    textAlign: 'right',
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 12,
    color: colors.muted,
  },
});
