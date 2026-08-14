import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import {
  changeEmail,
  changePassword,
  fetchUserSettings,
  getSettingsErrorMessage,
  updatePromptBankImportAfterExam,
} from '../lib/userSettingsApi';
import { colors } from '../theme/colors';

type Props = {
  onBack: () => void;
  onSignOut?: () => void;
  showSignOut?: boolean;
  onEmailChanged?: () => void;
};

type PasswordFieldProps = {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  visible: boolean;
  onToggleVisible: () => void;
};

function PasswordField({
  label,
  value,
  onChangeText,
  visible,
  onToggleVisible,
}: PasswordFieldProps) {
  return (
    <>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.passwordRow}>
        <TextInput
          secureTextEntry={!visible}
          value={value}
          onChangeText={onChangeText}
          placeholder="••••••••"
          placeholderTextColor={colors.muted}
          style={styles.passwordInput}
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="password"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={visible ? 'パスワードを隠す' : 'パスワードを表示'}
          onPress={onToggleVisible}
          style={({ pressed }) => [
            styles.visibilityButton,
            pressed && styles.visibilityButtonPressed,
          ]}
        >
          <Text style={styles.visibilityButtonLabel}>
            {visible ? '非表示' : '表示'}
          </Text>
        </Pressable>
      </View>
    </>
  );
}

export function CertSettingScreen({
  onBack,
  onSignOut,
  showSignOut = false,
  onEmailChanged,
}: Props) {
  const { width } = useWindowDimensions();
  const isWide = width >= 768;
  const [signOutBusy, setSignOutBusy] = useState(false);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currentEmail, setCurrentEmail] = useState('');
  const [promptBankImport, setPromptBankImport] = useState(true);
  const [prefBusy, setPrefBusy] = useState(false);

  const [emailDraft, setEmailDraft] = useState('');
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailMessage, setEmailMessage] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [nextPassword, setNextPassword] = useState('');
  const [nextPasswordConfirm, setNextPasswordConfirm] = useState('');
  const [currentPasswordVisible, setCurrentPasswordVisible] = useState(false);
  const [nextPasswordVisible, setNextPasswordVisible] = useState(false);
  const [confirmPasswordVisible, setConfirmPasswordVisible] = useState(false);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const settings = await fetchUserSettings();
      setCurrentEmail(settings.mailAddress);
      setEmailDraft(settings.mailAddress);
      setPromptBankImport(settings.promptBankImportAfterExam);
    } catch (error) {
      setLoadError(
        getSettingsErrorMessage(error, '設定の取得に失敗しました。'),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleTogglePrompt = async (next: boolean) => {
    if (prefBusy) return;
    const previous = promptBankImport;
    setPromptBankImport(next);
    setPrefBusy(true);
    try {
      await updatePromptBankImportAfterExam(next);
    } catch (error) {
      setPromptBankImport(previous);
      setLoadError(
        getSettingsErrorMessage(error, '設定の保存に失敗しました。'),
      );
    } finally {
      setPrefBusy(false);
    }
  };

  const handleChangeEmail = async () => {
    if (emailBusy) return;
    setEmailBusy(true);
    setEmailError(null);
    setEmailMessage(null);
    try {
      await changeEmail(emailDraft);
      setEmailMessage(
        '確認メールを送信しました。新しいアドレスのリンクを開くと変更が完了します。',
      );
      onEmailChanged?.();
    } catch (error) {
      setEmailError(
        getSettingsErrorMessage(error, 'メールアドレスの変更に失敗しました。'),
      );
    } finally {
      setEmailBusy(false);
    }
  };

  const handleChangePassword = async () => {
    if (passwordBusy) return;
    if (nextPassword !== nextPasswordConfirm) {
      setPasswordError('新しいパスワードが一致しません。');
      return;
    }
    setPasswordBusy(true);
    setPasswordError(null);
    setPasswordMessage(null);
    try {
      await changePassword({
        currentPassword,
        nextPassword,
      });
      setCurrentPassword('');
      setNextPassword('');
      setNextPasswordConfirm('');
      setPasswordMessage('パスワードを変更しました。');
    } catch (error) {
      setPasswordError(
        getSettingsErrorMessage(error, 'パスワードの変更に失敗しました。'),
      );
    } finally {
      setPasswordBusy(false);
    }
  };

  const emailReady =
    emailDraft.trim().length > 0 &&
    emailDraft.trim().toLowerCase() !== currentEmail.trim().toLowerCase() &&
    !emailBusy;
  const passwordReady =
    currentPassword.length >= 6 &&
    nextPassword.length >= 6 &&
    nextPasswordConfirm.length >= 6 &&
    !passwordBusy;

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
        <Text style={styles.title}>設定</Text>
        <View style={styles.headerSpacer} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : loadError && !currentEmail ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{loadError}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              void load();
            }}
            style={({ pressed }) => [
              styles.secondaryButton,
              pressed && styles.secondaryButtonPressed,
            ]}
          >
            <Text style={styles.secondaryButtonLabel}>再読み込み</Text>
          </Pressable>
        </View>
      ) : (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.flex}
        >
          <ScrollView
            contentContainerStyle={[
              styles.content,
              isWide && styles.contentWide,
            ]}
            keyboardShouldPersistTaps="handled"
          >
            {loadError ? (
              <Text style={styles.inlineError}>{loadError}</Text>
            ) : null}

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>共有バンク</Text>
              <Text style={styles.sectionLead}>
                未取り込みの共有バンク問題があるとき、模擬試験の終了後に取り込み確認を出すかどうかを選べます。
              </Text>
              <View style={styles.switchRow}>
                <View style={styles.switchCopy}>
                  <Text style={styles.switchLabel}>
                    試験後に取り込み確認を表示
                  </Text>
                  <Text style={styles.switchHint}>
                    OFF にするとダイアログは出ません（問題の実体は共有のままです）
                  </Text>
                </View>
                <Switch
                  value={promptBankImport}
                  onValueChange={(value) => {
                    void handleTogglePrompt(value);
                  }}
                  disabled={prefBusy}
                  trackColor={{ false: colors.line, true: colors.accentSoft }}
                  thumbColor={
                    promptBankImport ? colors.accent : colors.muted
                  }
                />
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>メールアドレス</Text>
              <Text style={styles.sectionLead}>
                現在: {currentEmail || '（未取得）'}
              </Text>
              <Text style={styles.label}>新しいメールアドレス</Text>
              <TextInput
                value={emailDraft}
                onChangeText={setEmailDraft}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                textContentType="emailAddress"
                placeholder="name@example.com"
                placeholderTextColor={colors.muted}
                style={styles.input}
              />
              {emailError ? (
                <Text style={styles.inlineError}>{emailError}</Text>
              ) : null}
              {emailMessage ? (
                <Text style={styles.inlineSuccess}>{emailMessage}</Text>
              ) : null}
              <Pressable
                accessibilityRole="button"
                disabled={!emailReady}
                onPress={() => {
                  void handleChangeEmail();
                }}
                style={({ pressed }) => [
                  styles.primaryButton,
                  !emailReady && styles.buttonDisabled,
                  pressed && emailReady && styles.primaryButtonPressed,
                ]}
              >
                {emailBusy ? (
                  <ActivityIndicator color={colors.paper} />
                ) : (
                  <Text style={styles.primaryButtonLabel}>
                    メールアドレスを変更
                  </Text>
                )}
              </Pressable>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>パスワード</Text>
              <Text style={styles.sectionLead}>
                現在のパスワードを確認してから新しいパスワードに更新します。
              </Text>
              <PasswordField
                label="現在のパスワード"
                value={currentPassword}
                onChangeText={setCurrentPassword}
                visible={currentPasswordVisible}
                onToggleVisible={() =>
                  setCurrentPasswordVisible((prev) => !prev)
                }
              />
              <PasswordField
                label="新しいパスワード（6文字以上）"
                value={nextPassword}
                onChangeText={setNextPassword}
                visible={nextPasswordVisible}
                onToggleVisible={() => setNextPasswordVisible((prev) => !prev)}
              />
              <PasswordField
                label="新しいパスワード（確認）"
                value={nextPasswordConfirm}
                onChangeText={setNextPasswordConfirm}
                visible={confirmPasswordVisible}
                onToggleVisible={() =>
                  setConfirmPasswordVisible((prev) => !prev)
                }
              />
              {passwordError ? (
                <Text style={styles.inlineError}>{passwordError}</Text>
              ) : null}
              {passwordMessage ? (
                <Text style={styles.inlineSuccess}>{passwordMessage}</Text>
              ) : null}
              <Pressable
                accessibilityRole="button"
                disabled={!passwordReady}
                onPress={() => {
                  void handleChangePassword();
                }}
                style={({ pressed }) => [
                  styles.primaryButton,
                  !passwordReady && styles.buttonDisabled,
                  pressed && passwordReady && styles.primaryButtonPressed,
                ]}
              >
                {passwordBusy ? (
                  <ActivityIndicator color={colors.paper} />
                ) : (
                  <Text style={styles.primaryButtonLabel}>
                    パスワードを変更
                  </Text>
                )}
              </Pressable>
            </View>

            {showSignOut && onSignOut ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>セッション</Text>
                <Text style={styles.sectionLead}>
                  この端末からログアウトします。
                </Text>
                <Pressable
                  accessibilityRole="button"
                  disabled={signOutBusy}
                  onPress={() => {
                    if (signOutBusy) return;
                    setSignOutBusy(true);
                    void Promise.resolve(onSignOut()).finally(() => {
                      setSignOutBusy(false);
                    });
                  }}
                  style={({ pressed }) => [
                    styles.signOutButton,
                    pressed && styles.signOutButtonPressed,
                    signOutBusy && styles.buttonDisabled,
                  ]}
                >
                  {signOutBusy ? (
                    <ActivityIndicator color={colors.spotlightDeep} />
                  ) : (
                    <Text style={styles.signOutButtonLabel}>ログアウト</Text>
                  )}
                </Pressable>
              </View>
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.mist,
  },
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
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
    color: colors.accentDeep,
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 18,
    color: colors.ink,
  },
  headerSpacer: {
    width: 72,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 24,
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 40,
    gap: 20,
  },
  contentWide: {
    maxWidth: 640,
    width: '100%',
    alignSelf: 'center',
  },
  section: {
    backgroundColor: colors.paper,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 16,
    gap: 10,
  },
  sectionTitle: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 16,
    color: colors.ink,
  },
  sectionLead: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 13,
    lineHeight: 20,
    color: colors.inkSoft,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 4,
  },
  switchCopy: {
    flex: 1,
    gap: 4,
  },
  switchLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 14,
    color: colors.ink,
  },
  switchHint: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 12,
    lineHeight: 18,
    color: colors.muted,
  },
  label: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 13,
    color: colors.inkSoft,
    marginTop: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 15,
    color: colors.ink,
    backgroundColor: colors.mist,
  },
  passwordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  passwordInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 15,
    color: colors.ink,
    backgroundColor: colors.mist,
  },
  visibilityButton: {
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  visibilityButtonPressed: {
    backgroundColor: colors.accent,
  },
  visibilityButtonLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 12,
    color: colors.accentDeep,
  },
  primaryButton: {
    marginTop: 6,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: colors.accent,
  },
  primaryButtonPressed: {
    backgroundColor: colors.accentDeep,
  },
  primaryButtonLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 14,
    color: colors.paper,
  },
  secondaryButton: {
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.line,
  },
  secondaryButtonPressed: {
    backgroundColor: colors.accentSoft,
  },
  secondaryButtonLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 13,
    color: colors.accentDeep,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  errorText: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 14,
    color: colors.spotlightDeep,
    textAlign: 'center',
  },
  inlineError: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 13,
    color: colors.spotlightDeep,
  },
  inlineSuccess: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 13,
    color: colors.accentDeep,
  },
  signOutButton: {
    marginTop: 6,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: '#FFF1EC',
    borderWidth: 1,
    borderColor: colors.spotlight,
  },
  signOutButtonPressed: {
    backgroundColor: '#FFE4DB',
  },
  signOutButtonLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 14,
    color: colors.spotlightDeep,
  },
});
