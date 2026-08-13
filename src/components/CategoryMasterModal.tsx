import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  fetchCertificationCategories,
  fetchCumulativeAnalysis,
  getAnalysisErrorMessage,
} from '../lib/analysisApi';
import { colors } from '../theme/colors';
import type { CategoryUnderstanding } from '../types/analysis';

type Props = {
  visible: boolean;
  certificationId: string;
  onClose: () => void;
};

export function CategoryMasterModal({
  visible,
  certificationId,
  onClose,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<CategoryUnderstanding[]>([]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const [cats, snap] = await Promise.all([
          fetchCertificationCategories(certificationId),
          fetchCumulativeAnalysis(certificationId, 'all'),
        ]);
        if (cancelled) return;
        const byId = new Map(
          snap.categories.map((c) => [c.categoryId, c] as const),
        );
        setRows(
          cats.map(
            (cat) =>
              byId.get(cat.id) ?? {
                categoryId: cat.id,
                name: cat.name,
                correctCount: 0,
                answeredCount: 0,
                rate: null,
              },
          ),
        );
      } catch (err) {
        if (!cancelled) {
          setError(
            getAnalysisErrorMessage(err, 'カテゴリ一覧の取得に失敗しました。'),
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, certificationId]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.title}>カテゴリ一覧</Text>
            <Pressable
              accessibilityRole="button"
              onPress={onClose}
              style={({ pressed }) => [
                styles.closeButton,
                pressed && styles.closePressed,
              ]}
            >
              <Text style={styles.closeLabel}>閉じる</Text>
            </Pressable>
          </View>
          <Text style={styles.lead}>
            この資格のカテゴリマスタです（累積の正解率付き）
          </Text>
          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.accent} />
            </View>
          ) : error ? (
            <Text style={styles.errorText}>{error}</Text>
          ) : rows.length === 0 ? (
            <Text style={styles.empty}>カテゴリがまだありません</Text>
          ) : (
            <ScrollView contentContainerStyle={styles.list}>
              {rows.map((row) => (
                <View key={row.categoryId} style={styles.item}>
                  <Text style={styles.name}>{row.name}</Text>
                  <Text style={styles.meta}>
                    {row.rate == null
                      ? '未計測'
                      : `${row.rate}%（${row.correctCount}/${row.answeredCount}）`}
                  </Text>
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(20, 28, 36, 0.45)',
  },
  card: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '80%',
    backgroundColor: colors.paper,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 16,
    zIndex: 1,
    gap: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 17,
    color: colors.ink,
  },
  closeButton: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: colors.mist,
  },
  closePressed: {
    backgroundColor: colors.accentSoft,
  },
  closeLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 12,
    color: colors.inkSoft,
  },
  lead: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 12,
    color: colors.muted,
  },
  center: {
    paddingVertical: 28,
    alignItems: 'center',
  },
  errorText: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 13,
    color: colors.spotlightDeep,
  },
  empty: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 13,
    color: colors.muted,
    paddingVertical: 20,
  },
  list: {
    gap: 8,
    paddingBottom: 8,
  },
  item: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.mist,
    padding: 12,
    gap: 4,
  },
  name: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 14,
    color: colors.ink,
  },
  meta: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 12,
    color: colors.inkSoft,
  },
});
