import { useCallback, useEffect, useState } from 'react';
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
  fetchExampleContentReports,
  getReportErrorMessage,
  reopenExampleContentReport,
  resolveExampleContentReport,
} from '../lib/exampleReportsApi';
import { colors } from '../theme/colors';
import {
  reportTargetLabel,
  type ExampleContentReport,
} from '../types/exampleReport';

type Props = {
  onBack: () => void;
};

type ResolveDraft = {
  report: ExampleContentReport;
  responseText: string;
};

export function AdminReportsScreen({ onBack }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reports, setReports] = useState<ExampleContentReport[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [resolveDraft, setResolveDraft] = useState<ResolveDraft | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);

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

  const closeResolveFlow = () => {
    if (busyId) return;
    setResolveDraft(null);
    setConfirmOpen(false);
    setResolveError(null);
  };

  const handleStartResolve = (report: ExampleContentReport) => {
    if (busyId) return;
    setResolveDraft({ report, responseText: '' });
    setConfirmOpen(false);
    setResolveError(null);
  };

  const handleGoConfirm = () => {
    if (!resolveDraft) return;
    if (!resolveDraft.responseText.trim()) {
      setResolveError('対応内容を入力してください。');
      return;
    }
    setResolveError(null);
    setConfirmOpen(true);
  };

  const handleConfirmResolve = async () => {
    if (!resolveDraft || busyId) return;
    const { report, responseText } = resolveDraft;
    setBusyId(report.id);
    setResolveError(null);
    try {
      await resolveExampleContentReport({
        reportId: report.id,
        adminResponse: responseText,
      });
      setReports((prev) =>
        prev.map((item) =>
          item.id === report.id
            ? {
                ...item,
                status: 'resolved',
                adminResponse: responseText.trim(),
                resolvedAt: new Date().toISOString(),
              }
            : item,
        ),
      );
      setResolveDraft(null);
      setConfirmOpen(false);
    } catch (err) {
      setResolveError(
        getReportErrorMessage(err, '対応済への更新に失敗しました。'),
      );
      setConfirmOpen(false);
    } finally {
      setBusyId(null);
    }
  };

  const handleReopen = async (report: ExampleContentReport) => {
    if (busyId) return;
    setBusyId(report.id);
    try {
      await reopenExampleContentReport(report.id);
      setReports((prev) =>
        prev.map((item) =>
          item.id === report.id
            ? {
                ...item,
                status: 'open',
                adminResponse: null,
                resolvedAt: null,
              }
            : item,
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
              {report.status === 'resolved' && report.adminResponse ? (
                <View style={styles.responseBox}>
                  <Text style={styles.responseLabel}>対応内容</Text>
                  <Text style={styles.responseBody}>{report.adminResponse}</Text>
                </View>
              ) : null}
              {report.status === 'open' ? (
                <Pressable
                  accessibilityRole="button"
                  disabled={busyId === report.id}
                  onPress={() => handleStartResolve(report)}
                  style={({ pressed }) => [
                    styles.statusButton,
                    pressed && styles.statusButtonPressed,
                  ]}
                >
                  <Text style={styles.statusButtonLabel}>対応済にする</Text>
                </Pressable>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  disabled={busyId === report.id}
                  onPress={() => {
                    void handleReopen(report);
                  }}
                  style={({ pressed }) => [
                    styles.statusButton,
                    pressed && styles.statusButtonPressed,
                  ]}
                >
                  {busyId === report.id ? (
                    <ActivityIndicator color={colors.accentDeep} />
                  ) : (
                    <Text style={styles.statusButtonLabel}>未対応に戻す</Text>
                  )}
                </Pressable>
              )}
            </View>
          ))}
        </ScrollView>
      )}

      <Modal
        visible={resolveDraft != null && !confirmOpen}
        transparent
        animationType="fade"
        onRequestClose={closeResolveFlow}
      >
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalBackdrop} onPress={closeResolveFlow} />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>対応内容を入力</Text>
            <Text style={styles.modalLead}>
              報告者の通知に表示されます。対応方針や修正内容を書いてください。
            </Text>
            {resolveDraft ? (
              <Text style={styles.modalMeta} numberOfLines={2}>
                {resolveDraft.report.exampleTitle}
              </Text>
            ) : null}
            <TextInput
              value={resolveDraft?.responseText ?? ''}
              onChangeText={(text) => {
                setResolveDraft((prev) =>
                  prev ? { ...prev, responseText: text } : prev,
                );
                if (resolveError) setResolveError(null);
              }}
              multiline
              placeholder="例: 問題文の誤記を修正しました。"
              placeholderTextColor={colors.muted}
              style={styles.modalInput}
              textAlignVertical="top"
            />
            {resolveError ? (
              <Text style={styles.modalError}>{resolveError}</Text>
            ) : null}
            <View style={styles.modalActions}>
              <Pressable
                accessibilityRole="button"
                onPress={closeResolveFlow}
                style={({ pressed }) => [
                  styles.modalSecondary,
                  pressed && styles.modalSecondaryPressed,
                ]}
              >
                <Text style={styles.modalSecondaryLabel}>キャンセル</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={handleGoConfirm}
                style={({ pressed }) => [
                  styles.modalPrimary,
                  pressed && styles.modalPrimaryPressed,
                ]}
              >
                <Text style={styles.modalPrimaryLabel}>確認へ</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={resolveDraft != null && confirmOpen}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!busyId) setConfirmOpen(false);
        }}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            style={styles.modalBackdrop}
            onPress={() => {
              if (!busyId) setConfirmOpen(false);
            }}
          />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>対応内容の確認</Text>
            <Text style={styles.modalLead}>
              この内容で対応済にし、報告者へ通知します。よろしいですか？
            </Text>
            <ScrollView style={styles.confirmScroll}>
              <Text style={styles.confirmBody}>
                {resolveDraft?.responseText.trim() ?? ''}
              </Text>
            </ScrollView>
            {resolveError ? (
              <Text style={styles.modalError}>{resolveError}</Text>
            ) : null}
            <View style={styles.modalActions}>
              <Pressable
                accessibilityRole="button"
                disabled={Boolean(busyId)}
                onPress={() => setConfirmOpen(false)}
                style={({ pressed }) => [
                  styles.modalSecondary,
                  pressed && styles.modalSecondaryPressed,
                ]}
              >
                <Text style={styles.modalSecondaryLabel}>戻る</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={Boolean(busyId)}
                onPress={() => {
                  void handleConfirmResolve();
                }}
                style={({ pressed }) => [
                  styles.modalPrimary,
                  pressed && styles.modalPrimaryPressed,
                ]}
              >
                {busyId ? (
                  <ActivityIndicator color={colors.paper} />
                ) : (
                  <Text style={styles.modalPrimaryLabel}>対応済にする</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
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
  responseBox: {
    marginTop: 6,
    borderRadius: 10,
    backgroundColor: colors.mist,
    padding: 10,
    gap: 4,
  },
  responseLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 12,
    color: colors.accentDeep,
  },
  responseBody: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 13,
    lineHeight: 20,
    color: colors.inkSoft,
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
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(20, 28, 36, 0.45)',
  },
  modalCard: {
    width: '100%',
    maxWidth: 480,
    backgroundColor: colors.paper,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 18,
    gap: 10,
    zIndex: 1,
  },
  modalTitle: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 17,
    color: colors.ink,
  },
  modalLead: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 13,
    lineHeight: 20,
    color: colors.inkSoft,
  },
  modalMeta: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 13,
    color: colors.muted,
  },
  modalInput: {
    minHeight: 120,
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
  modalError: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 13,
    color: colors.spotlightDeep,
  },
  confirmScroll: {
    maxHeight: 180,
    borderRadius: 12,
    backgroundColor: colors.mist,
    padding: 12,
  },
  confirmBody: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 14,
    lineHeight: 22,
    color: colors.ink,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 4,
  },
  modalSecondary: {
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.line,
  },
  modalSecondaryPressed: {
    backgroundColor: colors.mist,
  },
  modalSecondaryLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 13,
    color: colors.inkSoft,
  },
  modalPrimary: {
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: colors.accentDeep,
    minWidth: 120,
    alignItems: 'center',
  },
  modalPrimaryPressed: {
    opacity: 0.88,
  },
  modalPrimaryLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 13,
    color: colors.paper,
  },
});
