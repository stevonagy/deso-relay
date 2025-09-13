import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { likePost, sendDiamonds } from '../lib/deso';


export type Post = {
PostHashHex: string;
Body: string;
PosterUsername?: string;
};


export default function PostCard({ post }: { post: Post }) {
const onLike = async () => { await likePost(post.PostHashHex, true); };
const onDiamond = async () => { await sendDiamonds({ postHashHex: post.PostHashHex, diamondLevel: 1 }); };


return (
<View style={{ padding: 12, borderBottomWidth: 1, borderColor: '#e5e7eb', gap: 8 }}>
<Text style={{ fontWeight: '700' }}>{post.PosterUsername ?? 'user'}</Text>
<Text>{post.Body}</Text>
<View style={{ flexDirection: 'row', gap: 12 }}>
<Pressable onPress={onLike}><Text>👍 Like</Text></Pressable>
<Pressable onPress={onDiamond}><Text>💎 Tip</Text></Pressable>
</View>
</View>
);
}