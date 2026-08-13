import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  fetchCumulativeAnalysis,
  getAnalysisErrorMessage,
} from '../lib/analysisApi';
import {
  getReportErrorMessage,
  submitMasterChangeReport,
} from '../lib/exampleReportsApi';
import { colors } from '../theme/colors';
import type { AnalysisPeriod, AnalysisSnapshot } from '../types/analysis';
import { CategoryRadarChart } from './CategoryRadarChart';

type Props = {
  visible: boolean;
  certificationId: string;
  certificationName: string;
  onClose: () => void;
  onOpenCategoryMaster: () => void;
};

const PERIODS: Array<{ id: AnalysisPeriod; label: string }> = [
  { id: 'all', label: '全体' },
  { id: 'month', label: '月次' },
  { id: 'week', label: '週次' },
];

export function AnalysisModal({
  visible,
  certificationId,
  certificationName,
  onClose,
  onOpenCategoryMaster,
}: Props) {
  const [period, setPeriod] = useState<AnalysisPeriod>('all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<AnalysisSnapshot | null>(null);
  const [inquiryOpen, setInquiryOpen] = useState(false);
  const [inquiryTarget, setInquiryTarget] = useState<
    'category_master' | 'keyword_master'
  >('category_master');
  const [inquiryMessage, setInquiryMessage] = useState('');
  const [inquiryBusy, setInquiryBusy] = useState(false);
  const [inquiryError, setInquiryError] = useState<string | null>(null);
  const [inquiryDone, setInquiryDone] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setPeriod('all');
    setInquiryOpen(false);
    setInquiryDone(false);
    setInquiryMessage('');
    setInquiryError(null);
  }, [visible, certificationId]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchCumulativeAnalysis(certificationId, period);
        if (!cancelled) setSnapshot(data);
      } catch (err) {
        if (!cancelled) {
          setError(
            getAnalysisErrorMessage(err, '分析データの取得に失敗しました。'),
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, certificationId, period]);

  const handleSubmitInquiry = async () => {
    if (!inquiryMessage.trim() || inquiryBusy) return;
    setInquiryBusy(true);
    setInquiryError(null);
    try {
      await submitMasterChangeReport({
        certificationId,
        certificationName,
        target: inquiryTarget,
        message: inquiryMessage,
      });
      setInquiryDone(true);
      setInquiryOpen(false);
      setInquiryMessage('');
    } catch (err) {
      setInquiryError(
        getReportErrorMessage(err, '問い合わせの送信に失敗しました。'),
      );
    } finally {
      setInquiryBusy(false);
    }
  };

  return (
    <>
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
              <Text style={styles.title}>分析</Text>
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
            <Text style={styles.lead}>{certificationName}</Text>

            <View style={styles.periodRow}>
              {PERIODS.map((item) => (
                <Pressable
                  key={item.id}
                  accessibilityRole="button"
                  onPress={() => setPeriod(item.id)}
                  style={[
                    styles.periodChip,
                    period === item.id && styles.periodChipActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.periodChipLabel,
                      period === item.id && styles.periodChipLabelActive,
                    ]}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            {loading ? (
              <View style={styles.center}>
                <ActivityIndicator color={colors.accent} />
              </View>
            ) : error ? (
              <View style={styles.center}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : snapshot ? (
              <ScrollView
                style={styles.scroll}
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator
              >
                <Text style={styles.sectionTitle}>
                  カテゴリ理解度（{snapshot.periodLabel}）
                </Text>
                <Text style={styles.hint}>
                  タグを押すとカテゴリ一覧を表示します
                </Text>
                <View style={styles.tagRow}>
                  {snapshot.categories.map((cat) => (
                    <Pressable
                      key={cat.categoryId}
                      accessibilityRole="button"
                      onPress={onOpenCategoryMaster}
                      style={({ pressed }) => [
                        styles.tag,
                        pressed && styles.tagPressed,
                      ]}
                    >
                      <Text style={styles.tagLabel}>
                        {cat.name}
                        {cat.rate == null ? '' : ` ${cat.rate}%`}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <CategoryRadarChart categories={snapshot.categories} />

                <Text style={[styles.sectionTitle, styles.sectionGap]}>
                  キーワード進捗（累積）
                </Text>
                <Text style={styles.keywordProgress}>
                  説明できたキーワード数：
                  {snapshot.keywordProgress.explainedCount}/
                  {snapshot.keywordProgress.totalCount}個
                  {snapshot.keywordProgress.rate != null
                    ? `（${snapshot.keywordProgress.rate}%）`
                    : ''}
                </Text>
                <Text style={styles.hint}>
                  理解度 A / B かつマスタ一致のみをカウントします
                </Text>

                {inquiryDone ? (
                  <Text style={styles.doneText}>
                    マスタ変更の問い合わせを受け付けました。
                  </Text>
                ) : null}

                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    setInquiryOpen(true);
                    setInquiryDone(false);
                  }}
                  style={({ pressed }) => [
                    styles.inquiryButton,
                    pressed && styles.inquiryButtonPressed,
                  ]}
                >
                  <Text style={styles.inquiryButtonLabel}>
                    カテゴリ・キーワード一覧の変更を問い合わせる
                  </Text>
                </Pressable>
              </ScrollView>
            ) : null}
          </View>
        </View>
      </Modal>

      <Modal
        visible={inquiryOpen}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!inquiryBusy) setInquiryOpen(false);
        }}
      >
        <View style={styles.overlay}>
          <Pressable
            style={styles.backdrop}
            onPress={() => {
              if (!inquiryBusy) setInquiryOpen(false);
            }}
          />
          <View style={[styles.card, styles.inquiryCard]}>
            <Text style={styles.title}>マスタ変更の問い合わせ</Text>
            <Text style={styles.lead}>
              追加・改名・削除してほしい内容を書いてください。管理者が確認します。
            </Text>
            <View style={styles.periodRow}>
              {(
                [
                  ['category_master', 'カテゴリ'],
                  ['keyword_master', 'キーワード'],
                ] as const
              ).map(([id, label]) => (
                <Pressable
                  key={id}
                  accessibilityRole="button"
                  onPress={() => setInquiryTarget(id)}
                  style={[
                    styles.periodChip,
                    inquiryTarget === id && styles.periodChipActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.periodChipLabel,
                      inquiryTarget === id && styles.periodChipLabelActive,
                    ]}
                  >
                    {label}
                  </Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              value={inquiryMessage}
              onChangeText={setInquiryMessage}
              multiline
              placeholder="例: ネットワークを分割し、VPC と DNS を別カテゴリにしてほしい"
              placeholderTextColor={colors.muted}
              style={styles.input}
              textAlignVertical="top"
            />
            {inquiryError ? (
              <Text style={styles.errorText}>{inquiryError}</Text>
            ) : null}
            <View style={styles.actions}>
              <Pressable
                accessibilityRole="button"
                disabled={inquiryBusy}
                onPress={() => setInquiryOpen(false)}
                style={({ pressed }) => [
                  styles.secondary,
                  pressed && styles.closePressed,
                ]}
              >
                <Text style={styles.closeLabel}>キャンセル</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={inquiryBusy || !inquiryMessage.trim()}
                onPress={() => {
                  void handleSubmitInquiry();
                }}
                style={({ pressed }) => [
                  styles.primary,
                  pressed && styles.primaryPressed,
                  (inquiryBusy || !inquiryMessage.trim()) && styles.primaryDisabled,
                ]}
              >
                {inquiryBusy ? (
                  <ActivityIndicator color={colors.paper} />
                ) : (
                  <Text style={styles.primaryLabel}>送信</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
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
    maxWidth: 560,
    maxHeight: '90%',
    backgroundColor: colors.paper,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 16,
    zIndex: 1,
    gap: 8,
  },
  inquiryCard: {
    maxWidth: 480,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  title: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 18,
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
    fontSize: 13,
    color: colors.inkSoft,
  },
  periodRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  periodChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: colors.mist,
  },
  periodChipActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  periodChipLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 12,
    color: colors.muted,
  },
  periodChipLabelActive: {
    color: colors.accentDeep,
  },
  center: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  errorText: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 13,
    color: colors.spotlightDeep,
    textAlign: 'center',
  },
  scroll: {
    flexGrow: 0,
  },
  scrollContent: {
    paddingBottom: 12,
    gap: 8,
  },
  sectionTitle: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 15,
    color: colors.ink,
  },
  sectionGap: {
    marginTop: 12,
  },
  hint: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 12,
    color: colors.muted,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  tag: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  tagPressed: {
    backgroundColor: colors.accent,
  },
  tagLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 11,
    color: colors.accentDeep,
  },
  keywordProgress: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 16,
    color: colors.ink,
  },
  doneText: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 13,
    color: colors.accentDeep,
  },
  inquiryButton: {
    marginTop: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.mist,
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: 'center',
  },
  inquiryButtonPressed: {
    backgroundColor: colors.accentSoft,
  },
  inquiryButtonLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 13,
    color: colors.inkSoft,
  },
  input: {
    minHeight: 110,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.mist,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 14,
    lineHeight: 22,
    color: colors.ink,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  secondary: {
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: colors.mist,
  },
  primary: {
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: colors.accentDeep,
    minWidth: 88,
    alignItems: 'center',
  },
  primaryPressed: {
    opacity: 0.9,
  },
  primaryDisabled: {
    opacity: 0.5,
  },
  primaryLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 13,
    color: colors.paper,
  },
});
