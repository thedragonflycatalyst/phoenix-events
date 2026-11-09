import { router, useLocalSearchParams } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { Button, Card, Txt } from '@/components/ui';
import { RULES, RULES_ENFORCEMENT, RULES_INTRO } from '@/lib/rules';
import { acceptRules } from '@/lib/rules-gate';
import { usePalette } from '@/lib/theme';

/** Community rules. With ?accept=1 it asks the person to agree before their first post or comment. */
export default function RulesScreen() {
  const p = usePalette();
  const { accept } = useLocalSearchParams<{ accept?: string }>();
  return (
    <ScrollView style={{ flex: 1, backgroundColor: p.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 12 }}>
      <Txt>{RULES_INTRO}</Txt>
      <Card style={{ gap: 14 }}>
        {RULES.map((r, i) => (
          <View key={r.title} style={{ gap: 4 }}>
            <Txt v="bold">{i + 1}. {r.title}</Txt>
            <Txt>{r.body}</Txt>
          </View>
        ))}
      </Card>
      <Txt v="small">{RULES_ENFORCEMENT}</Txt>
      {accept === '1' && (
        <Button icon="check" title="I agree to the community rules" onPress={() => { acceptRules(); router.back(); }} />
      )}
    </ScrollView>
  );
}
