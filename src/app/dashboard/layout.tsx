import { IBM_Plex_Sans, Space_Grotesk } from "next/font/google";

const ibmPlexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  variable: "--font-body",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-display",
});

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className={`dashboard-layout ${ibmPlexSans.variable} ${spaceGrotesk.variable}`}>
      {children}
      {/* AnyChat Admin Live Chat Widget */}
      <script
        dangerouslySetInnerHTML={{
          __html: `var anw = window.anw || {
  mainButton: true,
  widgetID: '7771d40e-331c-3454-ab32-4608dd5ea431',
  apiKey: 'yDvYsdlhijan7CGecvPeaA',
  showNewMessagePopup: true,
  moduleConfigUrl: 'https://anychat.one/app'
};
(function(d, s, id){
  var js, fjs = d.getElementsByTagName(s)[0];
  if (d.getElementById(id)) return;
  js = d.createElement(s); js.id = id;
  js.src = 'https://api.anychat.one/widget/7771d40e-331c-3454-ab32-4608dd5ea431/admin-livechat-js?r=' + encodeURIComponent(window.location);
  fjs.parentNode.insertBefore(js, fjs);
}(document, 'script', 'contactus-jssdk'));`,
        }}
      />
    </div>
  );
}
