import { useCallback, useEffect, useState } from 'react';
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
  fetchUnreadNotificationCount,
  fetchUserNotifications,
  getNotificationErrorMessage,
  markNotificationRead,
} from '../lib/notificationsApi';
import { colors } from '../theme/colors';
import type { UserNotification } from '../types/notification';

type Props = {
  onOpenExample: (notification: UserNotification) => void;
  /** true のときベルボタンを描画しない（外部から openSignal で開く） */
  hideTrigger?: boolean;
  /** 値が変わったタイミングで通知パネルを開く */
  openSignal?: number | null;
};

function BellIcon({ color, size = 18 }: { color: string; size?: number }) {
  const bodyWidth = size * 0.58;
  const bodyHeight = size * 0.48;
  const baseWidth = size * 0.78;
  const baseHeight = size * 0.14;
  const dome = size * 0.29;
  const clapper = size * 0.2;
  const hanger = size * 0.16;

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: size,
        height: size,
        alignItems: 'center',
        justifyContent: 'flex-end',
      }}
    >
      <View
        style={{
          width: hanger,
          height: hanger * 0.7,
          borderTopLeftRadius: hanger,
          borderTopRightRadius: hanger,
          borderWidth: 1.5,
          borderBottomWidth: 0,
          borderColor: color,
          marginBottom: 1,
        }}
      />
      <View
        style={{
          width: bodyWidth,
          height: bodyHeight,
          borderTopLeftRadius: dome,
          borderTopRightRadius: dome,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          width: baseWidth,
          height: baseHeight,
          borderRadius: baseHeight,
          backgroundColor: color,
          marginTop: -1,
        }}
      />
      <View
        style={{
          width: clapper,
          height: clapper,
          borderRadius: clapper / 2,
          backgroundColor: color,
          marginTop: 1,
        }}
      />
    </View>
  );
}

export function NotificationBell({
  onOpenExample,
  hideTrigger = false,
  openSignal = null,
}: Props) {
  const [panelOpen, setPanelOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<UserNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [openingId, setOpeningId] = useState<string | null>(null);

  const refreshCount = useCallback(async () => {
    try {
      const count = await fetchUnreadNotificationCount();
      setUnreadCount(count);
    } catch (err) {
      console.error('[NotificationBell] count', err);
    }
  }, []);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await fetchUserNotifications();
      setItems(rows);
      setUnreadCount(rows.filter((row) => row.isUnread).length);
    } catch (err) {
      setError(
        getNotificationErrorMessage(err, '通知の取得に失敗しました。'),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshCount();
    const timer = setInterval(() => {
      void refreshCount();
    }, 60_000);
    return () => clearInterval(timer);
  }, [refreshCount]);

  useEffect(() => {
    if (!panelOpen) return;
    void loadList();
  }, [panelOpen, loadList]);

  useEffect(() => {
    if (openSignal == null) return;
    setPanelOpen(true);
  }, [openSignal]);

  const handleOpenItem = async (item: UserNotification) => {
    if (openingId) return;
    setOpeningId(item.id);
    try {
      if (item.isUnread) {
        await markNotificationRead(item.id);
        setItems((prev) =>
          prev.map((row) =>
            row.id === item.id
              ? { ...row, isUnread: false, readAt: new Date().toISOString() }
              : row,
          ),
        );
        setUnreadCount((prev) => Math.max(0, prev - 1));
      }
      setPanelOpen(false);
      onOpenExample(item);
    } catch (err) {
      setError(
        getNotificationErrorMessage(err, '通知を開けませんでした。'),
      );
    } finally {
      setOpeningId(null);
    }
  };

  const badgeLabel =
    unreadCount > 99 ? '99+' : unreadCount > 0 ? String(unreadCount) : null;

  return (
    <>
      {hideTrigger ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            badgeLabel
              ? `通知（未読 ${badgeLabel} 件）`
              : '通知'
          }
          onPress={() => setPanelOpen(true)}
          style={({ pressed }) => [
            styles.bellButton,
            pressed && styles.bellButtonPressed,
          ]}
        >
          <BellIcon color={colors.accentDeep} size={18} />
          {badgeLabel ? (
            <View style={styles.badge}>
              <Text style={styles.badgeLabel}>{badgeLabel}</Text>
            </View>
          ) : null}
        </Pressable>
      )}

      <Modal
        visible={panelOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setPanelOpen(false)}
      >
        <View style={styles.overlay}>
          <Pressable
            style={styles.backdrop}
            onPress={() => setPanelOpen(false)}
          />
          <View style={styles.panel}>
            <View style={styles.panelHeader}>
              <Text style={styles.panelTitle}>通知</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => setPanelOpen(false)}
                style={({ pressed }) => [
                  styles.closeButton,
                  pressed && styles.closeButtonPressed,
                ]}
              >
                <Text style={styles.closeButtonLabel}>閉じる</Text>
              </Pressable>
            </View>
            <Text style={styles.panelLead}>
              誤り連絡への対応結果です。タップすると該当の例題を開きます。
            </Text>

            {loading ? (
              <View style={styles.center}>
                <ActivityIndicator color={colors.accent} />
              </View>
            ) : error ? (
              <View style={styles.center}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : items.length === 0 ? (
              <View style={styles.center}>
                <Text style={styles.emptyText}>通知はまだありません</Text>
              </View>
            ) : (
              <ScrollView
                style={styles.list}
                contentContainerStyle={styles.listContent}
                showsVerticalScrollIndicator
              >
                {items.map((item) => (
                  <Pressable
                    key={item.id}
                    accessibilityRole="button"
                    disabled={openingId === item.id}
                    onPress={() => {
                      void handleOpenItem(item);
                    }}
                    style={({ pressed }) => [
                      styles.item,
                      item.isUnread && styles.itemUnread,
                      pressed && styles.itemPressed,
                    ]}
                  >
                    <View style={styles.itemTop}>
                      <Text style={styles.itemTitle}>{item.title}</Text>
                      {item.isUnread ? (
                        <Text style={styles.unreadMark}>未読</Text>
                      ) : null}
                    </View>
                    <Text style={styles.itemTime}>{item.createdAtLabel}</Text>
                    {item.exampleTitle ? (
                      <Text style={styles.itemExample} numberOfLines={1}>
                        {item.exampleTitle}
                      </Text>
                    ) : null}
                    <Text style={styles.itemBody} numberOfLines={4}>
                      {item.body}
                    </Text>
                    {openingId === item.id ? (
                      <ActivityIndicator
                        color={colors.accentDeep}
                        style={styles.itemSpinner}
                      />
                    ) : (
                      <Text style={styles.itemAction}>例題を開く →</Text>
                    )}
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  bellButton: {
    position: 'relative',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.line,
    minWidth: 40,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bellButtonPressed: {
    backgroundColor: colors.accentSoft,
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: colors.spotlightDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 10,
    color: colors.paper,
  },
  overlay: {
    flex: 1,
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
    paddingTop: 56,
    paddingHorizontal: 16,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(20, 28, 36, 0.35)',
  },
  panel: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '80%',
    backgroundColor: colors.paper,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 14,
    zIndex: 1,
    gap: 8,
  },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  panelTitle: {
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
  closeButtonPressed: {
    backgroundColor: colors.accentSoft,
  },
  closeButtonLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 12,
    color: colors.inkSoft,
  },
  panelLead: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 12,
    lineHeight: 18,
    color: colors.muted,
  },
  center: {
    paddingVertical: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 13,
    color: colors.muted,
  },
  errorText: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 13,
    color: colors.spotlightDeep,
    textAlign: 'center',
  },
  list: {
    flexGrow: 0,
  },
  listContent: {
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
  itemUnread: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  itemPressed: {
    opacity: 0.9,
  },
  itemTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  itemTitle: {
    flex: 1,
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 14,
    color: colors.ink,
  },
  unreadMark: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 11,
    color: colors.spotlightDeep,
  },
  itemTime: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 11,
    color: colors.muted,
  },
  itemExample: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 12,
    color: colors.inkSoft,
  },
  itemBody: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 13,
    lineHeight: 20,
    color: colors.inkSoft,
    marginTop: 2,
  },
  itemAction: {
    marginTop: 4,
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 12,
    color: colors.accentDeep,
  },
  itemSpinner: {
    marginTop: 4,
    alignSelf: 'flex-start',
  },
});
