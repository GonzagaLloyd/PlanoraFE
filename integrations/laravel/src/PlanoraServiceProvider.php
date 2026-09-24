<?php

namespace Planora\LaravelWidget;

use Illuminate\Support\Facades\Blade;
use Illuminate\Support\ServiceProvider;

class PlanoraServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->mergeConfigFrom(__DIR__.'/../config/planora.php', 'planora');

        $this->app->singleton(WidgetRenderer::class, fn ($app) => new WidgetRenderer($app['config']->get('planora', [])));
    }

    public function boot(): void
    {
        $this->publishes([
            __DIR__.'/../config/planora.php' => config_path('planora.php'),
        ], 'planora-config');

        // Usage: @planoraWidget in your main layout, just before </body>.
        Blade::directive('planoraWidget', fn () => '<?php echo \\'.self::class.'::html(); ?>');
    }

    /**
     * Renders the widget for the current request's user.
     */
    public static function html(): string
    {
        $config = config('planora', []);
        $user = auth($config['guard'] ?? null)->user();
        $fields = $config['user_fields'] ?? ['name' => 'name', 'email' => 'email'];

        $payload = $user ? [
            'id' => (string) $user->getAuthIdentifier(),
            'name' => isset($fields['name']) ? data_get($user, $fields['name']) : null,
            'email' => isset($fields['email']) ? data_get($user, $fields['email']) : null,
        ] : null;

        $nonce = class_exists(\Illuminate\Support\Facades\Vite::class) ? \Illuminate\Support\Facades\Vite::cspNonce() : null;

        return app(WidgetRenderer::class)->render($payload, $nonce);
    }
}
