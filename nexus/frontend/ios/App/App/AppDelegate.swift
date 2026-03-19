import UIKit
import Capacitor
import WebKit

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Configure the WKWebView once Capacitor has finished building its view hierarchy.
        // A short async hop lets the run-loop finish the initial VC setup first.
        DispatchQueue.main.async {
            self.configureNativeChrome()
        }
        return true
    }

    // Called every time the app enters the foreground — re-apply settings in
    // case a new view controller was presented while backgrounded.
    func applicationDidBecomeActive(_ application: UIApplication) {
        configureNativeChrome()
    }

    // ── Main configuration entry-point ────────────────────────────────────────

    private func configureNativeChrome() {
        guard let root = window?.rootViewController else { return }
        enforceFullScreen(root)
        configureWebViews(in: root.view)
    }

    // ── Full-screen enforcement ───────────────────────────────────────────────
    // Prevents iOS 13+ automatic `.pageSheet` style from making any VC
    // swipeable-to-dismiss. Walks the entire VC hierarchy.

    private func enforceFullScreen(_ vc: UIViewController) {
        vc.modalPresentationStyle = .fullScreen
        vc.children.forEach { enforceFullScreen($0) }
        if let presented = vc.presentedViewController {
            enforceFullScreen(presented)
        }
    }

    // ── WKWebView configuration ───────────────────────────────────────────────
    // Walk the full view hierarchy and apply config to every WKWebView found.
    // Capacitor embeds the WKWebView several layers deep inside CAPBridgeViewController.

    private func configureWebViews(in view: UIView) {
        if let wv = view as? WKWebView {
            applyWebViewSettings(wv)
        }
        view.subviews.forEach { configureWebViews(in: $0) }
    }

    private func applyWebViewSettings(_ wv: WKWebView) {
        // Disable tap-and-hold link preview → removes "Open in Safari" callout
        wv.allowsLinkPreview = false

        // Disable swipe-left/right back-forward navigation
        wv.allowsBackForwardNavigationGestures = false

        // Kill scroll bounce — the spring-back effect can look like a sheet dismiss
        wv.scrollView.bounces = false
        wv.scrollView.alwaysBounceVertical = false
        wv.scrollView.alwaysBounceHorizontal = false

        // Overscroll indicator is a web-app implementation detail, not native
        wv.scrollView.showsVerticalScrollIndicator = false
        wv.scrollView.showsHorizontalScrollIndicator = false

        // Lock content inset — Capacitor's `contentInset: 'always'` handles
        // safe areas; auto-adjustment would add an unwanted top gap.
        wv.scrollView.contentInsetAdjustmentBehavior = .never

        // Prevent pinch-to-zoom at the WKWebView layer.
        // iOS ignores user-scalable=no in Safari (browser) since iOS 10, but
        // inside a native WKWebView we can lock the zoom scale directly so
        // the viewport meta tag alone is not the only line of defence.
        wv.scrollView.minimumZoomScale = 1.0
        wv.scrollView.maximumZoomScale = 1.0
    }

    // ── Deep-link / URL handling (required by Capacitor) ─────────────────────

    func application(_ app: UIApplication,
                     open url: URL,
                     options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication,
                     continue userActivity: NSUserActivity,
                     restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        return ApplicationDelegateProxy.shared.application(application,
                                                           continue: userActivity,
                                                           restorationHandler: restorationHandler)
    }
}
