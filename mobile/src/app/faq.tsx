import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Card, Icon, Txt } from '@/components/ui';
import { FAQ } from '@/lib/faq';
import { usePalette } from '@/lib/theme';

/** Frequently asked questions: tap a question to open its answer. */
export default function FaqScreen() {
  const p = usePalette();
  const [open, setOpen] = useState<string | null>(null);
  return (
    <ScrollView style={{ flex: 1, backgroundColor: p.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      {FAQ.map((section) => (
        <View key={section.title} style={{ marginBottom: 18 }}>
          <Txt v="h2" style={{ marginBottom: 10 }}>{section.title}</Txt>
          <Card style={{ paddingVertical: 4 }}>
            {section.items.map((item, i) => {
              const id = `${section.title}:${i}`;
              const shown = open === id;
              return (
                <View key={id} style={{ borderTopWidth: i ? 1 : 0, borderColor: p.line }}>
                  <Pressable onPress={() => setOpen(shown ? null : id)} accessibilityRole="button" accessibilityState={{ expanded: shown }}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, paddingVertical: 10 }}>
                    <Txt v="bold" style={{ flex: 1 }}>{item.q}</Txt>
                    <Icon name={shown ? 'expand_less' : 'expand_more'} color={p.muted} />
                  </Pressable>
                  {shown && <Txt style={{ paddingBottom: 14 }}>{item.a}</Txt>}
                </View>
              );
            })}
          </Card>
        </View>
      ))}
      <Txt v="small" center>Still have a question? Email ThePhoenixCatalyst@outlook.com</Txt>
    </ScrollView>
  );
}
