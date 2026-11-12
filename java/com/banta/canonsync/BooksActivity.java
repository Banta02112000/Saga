package com.banta.canonsync;

// Kept so old shortcuts keep working: Books now lives in the one app screen.
public class BooksActivity extends MainActivity {
    @Override
    String startPage() {
        return "index.html#books";
    }
}
