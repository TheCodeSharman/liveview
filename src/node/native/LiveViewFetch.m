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
 * Compiled into the app by the liveview build hook. The +load method
 * runs automatically before main().
 */

static IMP sOriginalSendIMP;

static void LiveViewPatchedSend(APSHTTPRequest *self, SEL _cmd)
{
    if (!self.synchronous) {
        // Async request — use original implementation unchanged
        ((void (*)(id, SEL))sOriginalSendIMP)(self, _cmd);
        return;
    }

    // Synchronous request: temporarily make it async, call original send
    // (which starts the request without blocking), then pump the run loop
    // until the request completes.
    self.synchronous = NO;
    ((void (*)(id, SEL))sOriginalSendIMP)(self, _cmd);

    // Pump the run loop until the response is done
    NSDate *timeoutDate = [NSDate dateWithTimeIntervalSinceNow:30.0];
    while (self.response.readyState != APSHTTPResponseStateDone) {
        [[NSRunLoop currentRunLoop] runMode:NSDefaultRunLoopMode
                                 beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.01]];
        if ([timeoutDate timeIntervalSinceNow] <= 0) {
            break;
        }
    }

    // Restore synchronous flag
    self.synchronous = YES;
}

@interface LiveViewHTTPSwizzle : NSObject
@end

@implementation LiveViewHTTPSwizzle

+ (void)load
{
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        Method originalMethod = class_getInstanceMethod(
            [APSHTTPRequest class], @selector(send)
        );
        if (!originalMethod) {
            return;
        }
        sOriginalSendIMP = method_getImplementation(originalMethod);
        method_setImplementation(originalMethod, (IMP)LiveViewPatchedSend);
    });
}

@end
