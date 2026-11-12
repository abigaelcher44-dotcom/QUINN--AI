package com.quinn.ai;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(QuinnUpdaterPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
