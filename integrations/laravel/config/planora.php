<?php

return [

    /*
    | Turn the widget off without removing @planoraWidget from your layouts.
    */
    'enabled' => env('PLANORA_ENABLED', true),

    /*
    | Public site key from the Planora dashboard (pk_live_… / pk_test_…).
    */
    'site_key' => env('PLANORA_SITE_KEY'),

    /*
    | Server-side secret used to sign the logged-in user's id, so nobody can
    | pretend to be another user and read their tickets. Never expose it.
    */
    'secret' => env('PLANORA_SECRET'),

    'api_base' => env('PLANORA_API_BASE', 'https://api.planora.dev'),

    'cdn_url' => env('PLANORA_CDN_URL', 'https://cdn.planora.dev/widget/v1'),

    /*
    | Optional overrides of the branding set in the Planora dashboard.
    */
    'position' => env('PLANORA_POSITION'),        // bottom-right | bottom-left
    'color' => env('PLANORA_COLOR'),              // e.g. #0f766e
    'label' => env('PLANORA_LABEL'),              // launcher tooltip

    /*
    | Which guard identifies the user. Null uses the default guard.
    */
    'guard' => env('PLANORA_GUARD'),

    /*
    | Map your user model to the fields the widget shows. Keys are widget
    | fields, values are attribute names on your user model.
    */
    'user_fields' => [
        'name' => 'name',
        'email' => 'email',
    ],

];
