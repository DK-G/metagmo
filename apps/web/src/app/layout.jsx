import "./globals.css";

export const metadata = {
  title: "メタグモ | 見え方を切り替えるタグSNS",
  description:
    "事実を土台に、タグのワードクラウドと視界ボタンで見え方の差分を体験するWebサービス。",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
