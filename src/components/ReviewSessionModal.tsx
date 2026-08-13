import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { fetchExampleDetail } from '../lib/examplesApi';
import { applySm2, localDateString } from '../lib/sm2';
import {
  fetchDueSrsCards,
  getSrsErrorMessage,
  rateSrsCard,
} from '../lib/srsApi';
import { colors } from '../theme/colors';
import type { ExampleDetail } from '../types/example';
import { isSelectExample } from '../types/example';
import type { SrsCard, SrsRating } from '../types/srs';
import { SRS_SESSION_LIMIT, srsRatingLabel } from '../types/srs';

type Props = {
  visible: boolean;
  certificationId: string;
  onClose: () => void;
  onSessionFinished?: () => void;
};

const RATINGS: SrsRating[] = ['again', 'hard', 'good', 'easy'];

export function ReviewSessionModal({
  visible,
  certificationId,
  onClose,
  onSessionFinished,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queue, setQueue] = useState<SrsCard[]>([]);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [example, setExample] = useState<ExampleDetail | null>(null);
  const [exampleLoading, setExampleLoading] = useState(false);
  const [doneCount, setDoneCount] = useState(0);

  const today = useMemo(() => localDateString(), [visible]);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    setError(null);
    setIndex(0);
    setRevealed(false);
    setExample(null);
    setDoneCount(0);
    try {
      const cards = await fetchDueSrsCards(
        certificationId,
        today,
        SRS_SESSION_LIMIT,
      );
      setQueue(cards);
    } catch (err) {
      setError(getSrsErrorMessage(err, '復習カードの取得に失敗しました。'));
      setQueue([]);
    } finally {
      setLoading(false);
    }
  }, [certificationId, today]);

  useEffect(() => {
    if (!visible) return;
    void loadQueue();
  }, [visible, loadQueue]);

  const current = queue[index] ?? null;

  useEffect(() => {
    if (!visible || !current || current.kind !== 'example' || !current.exampleId) {
      setExample(null);
      return;
    }
    let cancelled = false;
    setExampleLoading(true);
    void (async () => {
      try {
        const detail = await fetchExampleDetail(current.exampleId!);
        if (!cancelled) setExample(detail);
      } catch (err) {
        if (!cancelled) {
          setError(
            getSrsErrorMessage(err, '例題の読み込みに失敗しました。'),
          );
          setExample(null);
        }
      } finally {
        if (!cancelled) setExampleLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, current?.id, current?.kind, current?.exampleId]);

  const previewIntervals = useMemo(() => {
    if (!current) return null;
    const base = {
      easeFactor: current.easeFactor,
      intervalDays: current.intervalDays,
      repetitions: current.repetitions,
    };
    return Object.fromEntries(
      RATINGS.map((rating) => {
        const next = applySm2(base, rating, today);
        if (rating === 'again') return [rating, 'すぐ'];
        return [rating, `${next.intervalDays}日後`];
      }),
    ) as Record<SrsRating, string>;
  }, [current, today]);

  const handleRate = async (rating: SrsRating) => {
    if (!current || busy) return;
    setBusy(true);
    setError(null);
    try {
      await rateSrsCard({ card: current, rating, today });
      const nextIndex = index + 1;
      setDoneCount((n) => n + 1);
      setRevealed(false);
      if (nextIndex >= queue.length) {
        onSessionFinished?.();
        onClose();
      } else {
        setIndex(nextIndex);
      }
    } catch (err) {
      setError(getSrsErrorMessage(err, '評価の保存に失敗しました。'));
    } finally {
      setBusy(false);
    }
  };

  const handleClose = () => {
    if (busy) return;
    if (doneCount > 0) onSessionFinished?.();
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={handleClose} />
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.title}>今日の復習</Text>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={handleClose}
              style={({ pressed }) => [
                styles.closeButton,
                pressed && styles.closePressed,
              ]}
            >
              <Text style={styles.closeLabel}>閉じる</Text>
            </Pressable>
          </View>

          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.accent} />
            </View>
          ) : error && !current ? (
            <View style={styles.center}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : queue.length === 0 ? (
            <View style={styles.center}>
              <Text style={styles.emptyText}>
                今日の復習はありません。お疲れさまです。
              </Text>
            </View>
          ) : current ? (
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={styles.progress}>
                {index + 1} / {queue.length}
                {current.kind === 'keyword' ? ' ・キーワード' : ' ・例題'}
              </Text>

              {current.kind === 'keyword' ? (
                <>
                  <Text style={styles.frontLabel}>キーワード</Text>
                  <Text style={styles.frontText}>{current.keywordText}</Text>
                  {revealed ? (
                    <View style={styles.backBox}>
                      <Text style={styles.backLabel}>前回の自己説明</Text>
                      <Text style={styles.backText}>
                        {current.keywordBack || '（説明なし）'}
                      </Text>
                    </View>
                  ) : null}
                </>
              ) : exampleLoading ? (
                <ActivityIndicator color={colors.accent} />
              ) : example ? (
                <>
                  <Text style={styles.frontLabel}>問題</Text>
                  <Text style={styles.frontText}>{example.question}</Text>
                  {isSelectExample(example) ? (
                    <View style={styles.choiceList}>
                      {example.choices.map((c, i) => (
                        <Text key={c.id} style={styles.choiceLine}>
                          {String.fromCharCode(65 + i)}. {c.value}
                        </Text>
                      ))}
                    </View>
                  ) : null}
                  {revealed ? (
                    <View style={styles.backBox}>
                      <Text style={styles.backLabel}>正解・解説</Text>
                      {isSelectExample(example) ? (
                        <Text style={styles.backText}>
                          正解:{' '}
                          {example.choices
                            .filter((c) => c.isAnswer)
                            .map((c) => c.value)
                            .join(' / ') || '—'}
                        </Text>
                      ) : (
                        <Text style={styles.backText}>
                          正解: {example.answer}
                        </Text>
                      )}
                      <Text style={[styles.backText, styles.explain]}>
                        {example.explanation}
                      </Text>
                    </View>
                  ) : null}
                </>
              ) : (
                <Text style={styles.errorText}>
                  例題を表示できません（削除済みの可能性があります）。
                </Text>
              )}

              {error ? <Text style={styles.errorText}>{error}</Text> : null}

              {!revealed ? (
                <Pressable
                  accessibilityRole="button"
                  disabled={busy || (current.kind === 'example' && exampleLoading)}
                  onPress={() => setRevealed(true)}
                  style={({ pressed }) => [
                    styles.revealButton,
                    pressed && styles.revealPressed,
                  ]}
                >
                  <Text style={styles.revealLabel}>答えを表示</Text>
                </Pressable>
              ) : (
                <View style={styles.ratingRow}>
                  {RATINGS.map((rating) => (
                    <Pressable
                      key={rating}
                      accessibilityRole="button"
                      disabled={busy}
                      onPress={() => {
                        void handleRate(rating);
                      }}
                      style={({ pressed }) => [
                        styles.ratingButton,
                        rating === 'again' && styles.ratingAgain,
                        rating === 'hard' && styles.ratingHard,
                        rating === 'good' && styles.ratingGood,
                        rating === 'easy' && styles.ratingEasy,
                        pressed && styles.ratingPressed,
                      ]}
                    >
                      <Text style={styles.ratingLabel}>
                        {srsRatingLabel(rating)}
                      </Text>
                      <Text style={styles.ratingHint}>
                        {previewIntervals?.[rating] ?? ''}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </ScrollView>
          ) : null}
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
  center: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  emptyText: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 14,
    color: colors.muted,
    textAlign: 'center',
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
    gap: 10,
    paddingBottom: 8,
  },
  progress: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 12,
    color: colors.muted,
  },
  frontLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 13,
    color: colors.accentDeep,
  },
  frontText: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 18,
    lineHeight: 28,
    color: colors.ink,
  },
  choiceList: {
    gap: 4,
  },
  choiceLine: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 14,
    color: colors.inkSoft,
  },
  backBox: {
    borderRadius: 12,
    backgroundColor: colors.mist,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 12,
    gap: 6,
  },
  backLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 12,
    color: colors.accentDeep,
  },
  backText: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 14,
    lineHeight: 22,
    color: colors.inkSoft,
  },
  explain: {
    marginTop: 4,
  },
  revealButton: {
    marginTop: 8,
    borderRadius: 12,
    backgroundColor: colors.accentDeep,
    paddingVertical: 12,
    alignItems: 'center',
  },
  revealPressed: {
    opacity: 0.9,
  },
  revealLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 14,
    color: colors.paper,
  },
  ratingRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  ratingButton: {
    flexGrow: 1,
    minWidth: '45%',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: 'center',
    borderWidth: 1,
  },
  ratingAgain: {
    backgroundColor: '#FFF1EC',
    borderColor: colors.spotlight,
  },
  ratingHard: {
    backgroundColor: '#FFF8E8',
    borderColor: '#C2811A',
  },
  ratingGood: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  ratingEasy: {
    backgroundColor: '#E8F6F0',
    borderColor: '#2F9E8E',
  },
  ratingPressed: {
    opacity: 0.88,
  },
  ratingLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 14,
    color: colors.ink,
  },
  ratingHint: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 11,
    color: colors.muted,
    marginTop: 2,
  },
});
