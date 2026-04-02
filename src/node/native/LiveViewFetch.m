#import <Foundation/Foundation.h>
#import <objc/runtime.h>
#import <objc/message.h>
#import <TitaniumKit/APSHTTPRequest.h>
#import <TitaniumKit/APSHTTPResponse.h>

/**
 * Swizzles -[APSHTTPRequest send] so that synchronous requests pump the
 * NSRunLoop while waiting, instead of using dispatch_semaphore_wait.
 * This allows UIKit to process scene-update callbacks and prevents the
 * iOS watchdog (0x8BADF00D) from killing the app.
 *
 * To avoid firing Kroll JS timers during the pump, we set the request's
 * runModes to a private mode and pump only that mode.  The HTTP response
 * callback is delivered in our private mode (so the request completes),
 * while Kroll timers (scheduled in NSDefaultRunLoopMode) are not fired.
 *
 * We also add our private mode to NSRunLoopCommonModes so that the
 * scene-update watchdog source (which monitors common modes) is
 * satisfied.
 *
 * Compiled into the app by the liveview build hook. The +load method
 * runs automatically before main().
 */

static IMP sOriginalSendIMP;
static NSString *const kLiveViewRunLoopMode = @"com.liveview.httpwait";
static BOOL sRunLoopModeRegistered = NO;

static void LiveViewPatchedSend(APSHTTPRequest *self, SEL _cmd)
{
    if (!self.synchronous) {
        ((void (*)(id, SEL))sOriginalSendIMP)(self, _cmd);
        return;
    }

    // Register our private mode as a common mode (once) so that
    // scene-update sources are delivered when we pump it.
    if (!sRunLoopModeRegistered) {
        CFRunLoopAddCommonMode(CFRunLoopGetMain(), (__bridge CFStringRef)kLiveViewRunLoopMode);
        sRunLoopModeRegistered = YES;
    }

    // Make async and set run modes so the response callback is
    // delivered in our private mode, not the default mode.
    self.synchronous = NO;
    self.runModes = @[kLiveViewRunLoopMode];
    ((void (*)(id, SEL))sOriginalSendIMP)(self, _cmd);

    // Pump our private mode until the response arrives.
    // Kroll timers are in NSDefaultRunLoopMode so they won't fire.
    // Scene-update sources are in common modes (which includes our
    // private mode) so the watchdog stays happy.
    NSTimeInterval deadline = [NSDate timeIntervalSinceReferenceDate] + 30.0;
    while (self.response.readyState != APSHTTPResponseStateDone) {
        CFRunLoopRunInMode((__bridge CFStringRef)kLiveViewRunLoopMode, 0.01, false);
        if ([NSDate timeIntervalSinceReferenceDate] > deadline) {
            break;
        }
    }

    self.synchronous = YES;
}

@interface LiveViewHTTPSwizzle : NSObject
@end

@implementation LiveViewHTTPSwizzle

+ (void)load
{
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        Method sendMethod = class_getInstanceMethod(
            [APSHTTPRequest class], @selector(send)
        );
        if (sendMethod) {
            sOriginalSendIMP = method_getImplementation(sendMethod);
            method_setImplementation(sendMethod, (IMP)LiveViewPatchedSend);
        }
    });
}

@end
