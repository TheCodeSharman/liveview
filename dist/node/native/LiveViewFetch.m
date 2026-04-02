#import <Foundation/Foundation.h>
#import <TitaniumKit/ObjcProxy.h>

/**
 * Provides a synchronous HTTP GET that pumps the CFRunLoop while waiting
 * for the response.  Unlike Ti.Network.HTTPClient's sync mode (which uses
 * dispatch_semaphore_wait and blocks the run loop entirely), this
 * implementation uses NSRunLoop runMode:beforeDate: so that UIKit scene-
 * update callbacks are still serviced.  This prevents the iOS watchdog
 * (0x8BADF00D) from killing the app during LiveView module loading.
 *
 * Exposed to JavaScript as:
 *   var LiveViewFetch = require('LiveViewFetch');
 *   var text = LiveViewFetch.fetch('http://...');
 */
@interface LiveViewFetch : ObjcProxy
@end

@implementation LiveViewFetch

- (NSString *)fetch:(NSString *)urlString
{
    NSURL *url = [NSURL URLWithString:urlString];
    if (!url) {
        return nil;
    }

    __block NSData *responseData = nil;
    __block BOOL finished = NO;

    NSURLSessionConfiguration *config = [NSURLSessionConfiguration ephemeralSessionConfiguration];
    config.timeoutIntervalForRequest = 10;
    NSURLSession *session = [NSURLSession sessionWithConfiguration:config];

    NSURLSessionDataTask *task = [session dataTaskWithURL:url
        completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
            if (!error && data) {
                responseData = data;
            }
            finished = YES;
        }];
    [task resume];

    // Pump the run loop while waiting — this services scene-update
    // callbacks and prevents the watchdog from killing us.
    NSDate *loopUntil;
    while (!finished) {
        loopUntil = [NSDate dateWithTimeIntervalSinceNow:0.05];
        [[NSRunLoop currentRunLoop] runMode:NSDefaultRunLoopMode beforeDate:loopUntil];
    }

    [session invalidateAndCancel];

    if (!responseData) {
        return nil;
    }

    return [[NSString alloc] initWithData:responseData encoding:NSUTF8StringEncoding];
}

@end
