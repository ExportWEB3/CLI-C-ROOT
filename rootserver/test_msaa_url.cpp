#include <windows.h>
#include <oleacc.h>
#include <string>
#include <iostream>

void FindUrl(IAccessible* pAcc, std::string& outUrl, int depth = 0) {
    if(!pAcc || depth > 20 || !outUrl.empty()) return;
    long count=0;
    if(FAILED(pAcc->get_accChildCount(&count)) || count==0) return;
    count = min(count, 50L);
    VARIANT* pVars = new VARIANT[count];
    long obtained = 0;
    if(SUCCEEDED(AccessibleChildren(pAcc, 0, count, pVars, &obtained))) {
        for(long i=0; i<obtained && outUrl.empty(); i++) {
            if(pVars[i].vt == VT_DISPATCH && pVars[i].pdispVal) {
                IAccessible* pChild = NULL;
                if(SUCCEEDED(pVars[i].pdispVal->QueryInterface(IID_IAccessible, (void**)&pChild))) {
                    VARIANT varSelf; VariantInit(&varSelf); varSelf.vt = VT_I4; varSelf.lVal = CHILDID_SELF;
                    VARIANT varRole; VariantInit(&varRole);
                    if(SUCCEEDED(pChild->get_accRole(varSelf, &varRole)) && varRole.vt == VT_I4) {
                        if(varRole.lVal == ROLE_SYSTEM_TEXT || varRole.lVal == ROLE_SYSTEM_COMBOBOX) {
                            BSTR val = NULL;
                            if(SUCCEEDED(pChild->get_accValue(varSelf, &val)) && val) {
                                std::wstring wstr(val);
                                SysFreeString(val);
                                if(wstr.find(L" http://\)==0