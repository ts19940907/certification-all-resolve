import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { colors } from '../theme/colors';

type Mode = 'signin' | 'signup';

type Props = {
  onAuthenticated: () => void;
};

type PasswordFieldProps = {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  visible: boolean;
  onToggleVisible: () => void;
  onSubmitEditing?: () => void;
};

function PasswordField({
  label,
  value,
  onChangeText,
  visible,
  onToggleVisible,
  onSubmitEditing,
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
          onSubmitEditing={onSubmitEditing}
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

export function AuthScreen({ onAuthenticated }: Props) {
  const { width } = useWindowDimensions();
  const isWide = width >= 768;
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [passwordConfirmVisible, setPasswordConfirmVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const trimmedEmail = email.trim();
  const passwordReady = password.length >= 6;
  const confirmReady =
    mode === 'signin' || (passwordConfirm.length >= 6 && password === passwordConfirm);
  const canSubmit =
    trimmedEmail.length > 0 && passwordReady && confirmReady && !busy;

  const showError = (message: string) => {
    setErrorMessage(message);
  };

  const handleSubmit = async () => {
    if (!trimmedEmail || !passwordReady || busy) return;

    if (mode === 'signup' && password !== passwordConfirm) {
      showError('パスワードが一致しません。確認用の入力を見直してください。');
      return;
    }

    if (!canSubmit) return;

    setBusy(true);
    setErrorMessage(null);

    try {
      if (mode === 'signup') {
        const { data: allowed, error: allowError } = await supabase.rpc(
          'is_email_allowed',
          { check_email: trimmedEmail },
        );

        if (allowError) {
          console.error('[auth] is_email_allowed', allowError);
          showError('許可メールの確認に失敗しました。時間をおいて再度お試しください。');
          return;
        }

        if (!allowed) {
          showError('このメールアドレスは登録を許可されていません。');
          return;
        }

        const { error } = await supabase.auth.signUp({
          email: trimmedEmail,
          password,
        });

        if (error) {
          console.error('[auth] signUp', error);
          showError(error.message || '登録に失敗しました。');
          return;
        }

        showError(
          '登録リクエストを送りました。確認メールが届いている場合は、リンクを開いてからログインしてください。届かない場合は、ダッシュボードでメール確認がオフかも確認してください。',
        );
        setMode('signin');
        setPasswordConfirm('');
        return;
      }

      const { error } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      });

      if (error) {
        console.error('[auth] signIn', error);
        showError(error.message || 'ログインに失敗しました。');
        return;
      }

      onAuthenticated();
    } catch (error) {
      console.error('[auth] unexpected', error);
      showError('予期しないエラーが発生しました。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <View style={styles.heroWash} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[styles.content, isWide && styles.contentWide]}
      >
        <Text style={styles.brand}>CertResolve</Text>
        <Text style={styles.headline}>
          {mode === 'signin' ? 'ログイン' : 'アカウント登録'}
        </Text>
        <Text style={styles.lead}>
          許可されたメールアドレスだけで利用できます。無料のメール認証を使います。
        </Text>

        <View style={styles.card}>
          <Text style={styles.label}>メールアドレス</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor={colors.muted}
            style={styles.input}
          />

          <PasswordField
            label="パスワード（6文字以上）"
            value={password}
            onChangeText={setPassword}
            visible={passwordVisible}
            onToggleVisible={() => setPasswordVisible((prev) => !prev)}
            onSubmitEditing={mode === 'signin' ? handleSubmit : undefined}
          />

          {mode === 'signup' ? (
            <PasswordField
              label="パスワード（確認）"
              value={passwordConfirm}
              onChangeText={setPasswordConfirm}
              visible={passwordConfirmVisible}
              onToggleVisible={() => setPasswordConfirmVisible((prev) => !prev)}
              onSubmitEditing={handleSubmit}
            />
          ) : null}

          {mode === 'signup' &&
          passwordConfirm.length > 0 &&
          password !== passwordConfirm ? (
            <Text style={styles.mismatchText}>パスワードが一致していません</Text>
          ) : null}

          <Pressable
            accessibilityRole="button"
            disabled={!canSubmit}
            onPress={handleSubmit}
            style={({ pressed }) => [
              styles.primaryButton,
              !canSubmit && styles.primaryButtonDisabled,
              pressed && canSubmit && styles.primaryButtonPressed,
            ]}
          >
            {busy ? (
              <ActivityIndicator color={colors.paper} />
            ) : (
              <Text
                style={[
                  styles.primaryButtonLabel,
                  !canSubmit && styles.primaryButtonLabelDisabled,
                ]}
              >
                {mode === 'signin' ? 'ログイン' : '登録する'}
              </Text>
            )}
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setMode(mode === 'signin' ? 'signup' : 'signin');
              setErrorMessage(null);
              setPasswordConfirm('');
              setPasswordVisible(false);
              setPasswordConfirmVisible(false);
            }}
            style={styles.switchLink}
          >
            <Text style={styles.switchLinkLabel}>
              {mode === 'signin'
                ? '初めての方はアカウント登録'
                : 'すでにアカウントがある方はログイン'}
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      <Modal
        visible={errorMessage != null}
        transparent
        animationType="fade"
        onRequestClose={() => setErrorMessage(null)}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            style={styles.modalBackdrop}
            onPress={() => setErrorMessage(null)}
          />
          <View style={[styles.modalCard, isWide && styles.modalCardWide]}>
            <Text style={styles.modalTitle}>お知らせ</Text>
            <Text style={styles.modalLead}>{errorMessage}</Text>
            <View style={styles.modalActions}>
              <Pressable
                accessibilityRole="button"
                onPress={() => setErrorMessage(null)}
                style={({ pressed }) => [
                  styles.primaryButton,
                  pressed && styles.primaryButtonPressed,
                ]}
              >
                <Text style={styles.primaryButtonLabel}>閉じる</Text>
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
  },
  heroWash: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '42%',
    backgroundColor: colors.accentSoft,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 40,
  },
  contentWide: {
    maxWidth: 480,
    width: '100%',
    alignSelf: 'center',
  },
  brand: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 28,
    color: colors.ink,
    marginBottom: 16,
  },
  headline: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 26,
    color: colors.ink,
    marginBottom: 10,
  },
  lead: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 15,
    lineHeight: 24,
    color: colors.inkSoft,
    marginBottom: 24,
  },
  card: {
    backgroundColor: colors.paper,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 20,
  },
  label: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 13,
    color: colors.inkSoft,
    marginBottom: 8,
  },
  input: {
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'web' ? 12 : 14,
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 16,
    color: colors.ink,
    marginBottom: 16,
    backgroundColor: colors.mist,
  },
  passwordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  passwordInput: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'web' ? 12 : 14,
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 16,
    color: colors.ink,
    backgroundColor: colors.mist,
  },
  visibilityButton: {
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: colors.mist,
    borderWidth: 1,
    borderColor: colors.line,
  },
  visibilityButtonPressed: {
    backgroundColor: colors.accentSoft,
  },
  visibilityButtonLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 13,
    color: colors.accentDeep,
  },
  mismatchText: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 13,
    color: colors.spotlightDeep,
    marginTop: -8,
    marginBottom: 12,
  },
  primaryButton: {
    borderRadius: 12,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
    paddingHorizontal: 16,
  },
  primaryButtonDisabled: {
    backgroundColor: colors.line,
  },
  primaryButtonPressed: {
    backgroundColor: colors.accentDeep,
  },
  primaryButtonLabel: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 15,
    color: colors.paper,
  },
  primaryButtonLabelDisabled: {
    color: colors.muted,
  },
  switchLink: {
    marginTop: 16,
    alignItems: 'center',
  },
  switchLinkLabel: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 14,
    color: colors.accentDeep,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(16, 42, 67, 0.45)',
  },
  modalCard: {
    backgroundColor: colors.paper,
    borderRadius: 18,
    paddingHorizontal: 20,
    paddingVertical: 22,
    zIndex: 1,
  },
  modalCardWide: {
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
  },
  modalTitle: {
    fontFamily: 'NotoSansJP_700Bold',
    fontSize: 20,
    color: colors.ink,
    marginBottom: 8,
  },
  modalLead: {
    fontFamily: 'NotoSansJP_400Regular',
    fontSize: 14,
    lineHeight: 22,
    color: colors.inkSoft,
    marginBottom: 16,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
});
