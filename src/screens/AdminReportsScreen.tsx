import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  fetchExampleContentReports,
  getReportErrorMessage,
  updateExampleContentReportStatus,
} from '../lib/exampleReportsApi';
import { colors } from '../theme/colors';
import {
  reportTargetLabel,
  type ExampleContentReport,
} from '../types/exampleReport';

type Props = {
  onBack: () => void;
};

export function AdminReportsScreen({ onBack }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reports, setReports] = useState<ExampleContentReport[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await fetchExampleContentReports();
      setReports(rows);
    } catch (err) {
      setError(
        getReportErrorMessage(err, '問い合わせ一覧の取得に失敗しました。'),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleResolve = async (report: ExampleContentReport) => {
    if (busyId) return;
    setBusyId(report.id);
    try {
      const next = report.status === 'open' ? 'resolved' : 'open';
      await updateExampleContentReportStatus({
        reportId: report.id,
        status: next,
      });
      setReports((prev) =>
        prev.map((item) =>
          item.id === report.id ? { ...item, status: next } : item,
        ),
      );
    } catch (err) {
      setError(
        getReportErrorMessage(err, 'ステータスの更新に失敗しました。'),
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          onPress={onBack}
          style={({ pressed }) => [
            styles.backButton,
            pressed && styles.backButtonPressed,
          ]}
        >
          <Text style={styles.backButtonLabel}>← 戻る</Text>
        </Pressable>
        <Text style={styles.title}>管理者｜誤り連絡一覧</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            void load();
          }}
          style={({ pressed }) => [
            styles.refreshButton,
            pressed && styles.refreshButtonPressed,
          ]}
        >
          <Text style={styles.refreshButtonLabel}>再読み込み</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : reports.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>まだ問い合わせはありません</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator
        >
          {reports.map((report) => (
            <View key={report.id} style={styles.card}>
              <View style={styles.cardTop}>
                <Text style={styles.time}>{report.createdAtLabel}</Text>
                <Text
                  style={[
                    styles.status,
                    report.status === 'open'
                      ? styles.statusOpen
                      : styles.statusResolved,
                  ]}
                >
                  {report.status === 'open' ? '未対応' : '対応済'}
                </Text>
              </View>
              <Text style={styles.certName} numberOfLines={1}>
                {report.certificationName || '（資格名なし）'}
              </Text>
              <Text style={styles.exampleTitle} numberOfLines={2}>
                {report.exampleTitle}
              </Text>
              <Text style={styles.meta}>
                対象: {reportTargetLabel(report.target)} ／ 例題ID:{' '}
                {report.exampleId}
              </Text>
              <Text style={styles.message}>{report.message}</Text>
              <Pressable
                accessibilityRole="button"
                disabled={busyId === report.id}
                onPress={() => {
                  void handleResolve(report);
                }}
                style={({ pressed }) => [
                  styles.statusButton,
                  pressed && styles.statusButtonPressed,
                ]}
              >
                {busyId === report.id ? (
                  <ActivityIndicator color={colors.accentDeep} />
                ) : (
                  <Text style={styles.statusButtonLabel}>
                    {report.status === 'open'
                      ? '対応済にする'
                      : '未対応に戻す'}
                  </Text>
                )}
              </Pressable>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.mist,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
  },
  backButton: {
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.line,
  },
  backButtonPressed: {
    backgroundColor: colors.accentSoft,
  },
  backButtonLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 13,
    color: colors.inkSoft,
  },
  title: {
    flex: 1,
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 18,
    color: colors.ink,
  },
  refreshButton: {
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: colors.accentSoft,
  },
  refreshButtonPressed: {
    backgroundColor: colors.accent,
  },
  refreshButtonLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 13,
    color: colors.accentDeep,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  emptyText: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 14,
    color: colors.muted,
  },
  errorText: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 14,
    color: colors.spotlightDeep,
    textAlign: 'center',
  },
  list: {
    flex: 1,
  },
  listContent: {
    gap: 12,
    paddingBottom: 24,
  },
  card: {
    backgroundColor: colors.paper,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 14,
    gap: 6,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  time: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 12,
    color: colors.muted,
  },
  status: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: 'hidden',
  },
  statusOpen: {
    color: colors.spotlightDeep,
    backgroundColor: '#FFF1EC',
  },
  statusResolved: {
    color: colors.accentDeep,
    backgroundColor: colors.accentSoft,
  },
  certName: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 12,
    color: colors.inkSoft,
  },
  exampleTitle: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 15,
    color: colors.ink,
  },
  meta: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 12,
    color: colors.muted,
  },
  message: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 14,
    lineHeight: 22,
    color: colors.inkSoft,
    marginTop: 4,
  },
  statusButton: {
    alignSelf: 'flex-start',
    marginTop: 8,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 120,
    alignItems: 'center',
  },
  statusButtonPressed: {
    backgroundColor: colors.accent,
  },
  statusButtonLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 13,
    color: colors.accentDeep,
  },
});
