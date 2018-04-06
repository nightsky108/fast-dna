import { Component, ElementRef, Input, SimpleChanges } from "@angular/core";
import { getDynamicStyles, SheetsManager, StyleSheet } from "jss";
import * as uuid from "uuid/v1";
import getStaticStyles from "./utilities/get-static-styles";
import { eventNames } from "./utilities/get-event-names";
import { isEmptyObject } from "./utilities/object";
import jss, { stylesheetManager } from "./jss";

/**
 * Type definition for a function that resovles to a CSS property value
 * It optionally expects a config object.
 */
export type CSSRuleResolver<T> = (config: T) => string;

/**
 * Definition of a set of css rules
 */
export interface ICSSRules<T> {
    [rule: string]: ICSSRules<T> | CSSRuleResolver<T> | string;
}

/**
 * Definition of a JSS style object
 */
export type ComponentStyles<T, C> = {
    [P in keyof T]: ICSSRules<C>;
};

/**
 * State interface for JSS manager
 */
export interface IJSSManagerState {
    /**
     * Stores a JSS stylesheet containing all config-driven styles rules for a component
     */
    dynamicStyleSheet?: any;

    /**
     * Stores a JSS stylesheet containing all static style rules for a component
     */
    staticStyleSheet?: any;
}

/**
 * Defines a object that has been separated into dynamic and static stylesheets
 */
export interface ISeparatedStylesheet<T, C> {
    /**
     * The static styles for a given component and stylesheet combination
     * TODO #144: these are always static so they shouldn't use CSSRuleResolver
     */
    staticStyles?: ComponentStyles<T, C>;

    /**
     * Store the jss stylesheet so that multiple components can access it
     */
    staticStyleSheet?: any;

    /**
     * The dynamic styles for a given component and stylesheet combination
     */
    dynamicStyles?: ComponentStyles<T, C>;
}

export type ClassNames<T> = {
    /**
     * A given class name generated by JSS
     */
    [className in keyof T]: string;
};

function manageJss<S, C>(styles?: ComponentStyles<S, C>): <T>(BaseComponent: any) => any {
    return function(BaseComponent: any): any {

        class JSSManager extends BaseComponent {
            /**
             * The style manager is responsible for attaching and detaching style elements when
             * components mount and un-mount
             */
            private static stylesheetManager: SheetsManager = stylesheetManager;

            /**
             * Map of all components that have been initialized via this component
             */
            private static componentMap: WeakMap<any, string> = new WeakMap();

            /**
             * Map of all style objects that have been initialized via this component
             */
            private static styleMap: WeakMap<any, string> = new WeakMap();

            /**
             * Store references to all separated stylesheets
             */
            private static separatedStyles: {[key: string]: ISeparatedStylesheet<S, C>} = {};

            /**
             * Tracks the ID of an instance of the JSSManager. Multiple instances can have the same ID
             * if the the backing Component and styles objects are shared because the ID is is derived from
             * both the Component and styles IDs
             */
            private instanceId: string;

            /**
             * The HTML class names as determined by the static and dymanic styles
             */
            private className: string;

            /**
             * The JSS managers state object
             */
            private state: any;

            private ngOnInit(): void {
                if (super.ngOnInit) {
                    super.ngOnInit();
                }

                this.state = {};

                this.el.nativeElement.addEventListener(eventNames.getConfig, (e: CustomEvent) => {
                    this.config = e.detail;

                    if (this.state.dynamicStyleSheet) {
                        this.state.dynamicStyleSheet.update(this.designSystem);
                    }
                }, true);

                const registerComponentEvent: CustomEvent = new CustomEvent(eventNames.registerComponent);
                this.el.nativeElement.dispatchEvent(registerComponentEvent);

                const updateStylesEvent: CustomEvent = new CustomEvent(eventNames.getConfig, {detail: {}});
                this.el.nativeElement.dispatchEvent(updateStylesEvent);

                this.el.nativeElement.addEventListener(eventNames.update, (e: CustomEvent) => {
                    this.el.nativeElement.dispatchEvent(updateStylesEvent);
                }, true);
            }

            private ngAfterContentInit(): void {
                if (super.ngAfterContentInit) {
                    super.ngAfterContentInit();
                }

                // On construction, check if the style object or component object have already been used.
                // If not, we need to store them in our weakmaps for later use
                if (!Boolean(JSSManager.styleMap.get(styles))) {
                    JSSManager.styleMap.set(styles, uuid());
                }

                if (!Boolean(JSSManager.componentMap.get(Component))) {
                    JSSManager.componentMap.set(Component, uuid());
                }

                const styleId: string = JSSManager.styleMap.get(styles);
                const componentId: string = JSSManager.componentMap.get(Component);

                // Store the instance id as a combination of the generated IDs
                this.instanceId = `${componentId}${styleId}`;
                let separatedStylesInstance: ISeparatedStylesheet<S, C> = JSSManager.separatedStyles[this.instanceId];

                // Check if we have a separatedStyles object stored at the instanceId key.
                // If we don"t, we need to create that object
                if (!Boolean(separatedStylesInstance)) {
                    separatedStylesInstance = JSSManager.separatedStyles[this.instanceId] = this.separateStyles(styles);
                }

                // Now lets store those newly created stylesheet objects in state so we can easily reference them later
                // Since dynamic styles can be different across components, we should create the dynamic styles as a
                // new object so that identity checks between dynamic stylesheets do not pass.
                const state: IJSSManagerState = {};

                // Extract the static stylesheet and dynamic style object and apply them to the state
                // object if they exist
                const staticStyleSheet: StyleSheet = separatedStylesInstance.staticStyleSheet;
                const dynamicStyles: StyleSheet = separatedStylesInstance.dynamicStyles;

                if (Boolean(staticStyleSheet)) {
                    state.staticStyleSheet = separatedStylesInstance.staticStyleSheet;
                }

                if (Boolean(dynamicStyles)) {
                    state.dynamicStyleSheet = jss.createStyleSheet(
                        JSSManager.separatedStyles[this.instanceId].dynamicStyles,
                        { link: true }
                    );
                }

                this.state = state;

                this.className = this.getClassNames()[(Object.keys(styles)[0] as any)];
            }

            private ngAfterViewInit(): void {
                if (super.ngAfterViewInit) {
                    super.ngAfterViewInit();
                }

                if (Boolean(this.state.staticStyleSheet)) {
                    JSSManager.stylesheetManager.add(this.state.staticStyleSheet, this.state.staticStyleSheet);
                    JSSManager.stylesheetManager.manage(this.state.staticStyleSheet);
                }

                if (Boolean(this.state.dynamicStyleSheet)) {
                    // It appears we need to update the stylesheet for any style properties defined as functions
                    // to work.
                    this.state.dynamicStyleSheet.attach().update(this.designSystem);
                }
            }

            private ngOnDestroy(): void {
                if (this.hasStaticStyleSheet()) {
                    JSSManager.stylesheetManager.unmanage(this.state.staticStyleSheet);
                }

                if (this.hasDynamicStyleSheet()) {
                    this.state.dynamicStyleSheet.detach();
                    jss.removeStyleSheet(this.state.dynamicStyleSheet);
                }

                const deregisterComponentEvent: CustomEvent = new CustomEvent(eventNames.deregisterComponent);
                this.el.nativeElement.dispatchEvent(deregisterComponentEvent);
            }

            private get designSystem(): any {
                return this.config ? this.config : {};
            }

            /**
             * Checks to see if this component has an associated static stylesheet
             */
            private hasStaticStyleSheet(): boolean {
                return Boolean(this.state.staticStyleSheet);
            }

            /**
             * Checks to see if this component has an associated dynamic stylesheet
             */
            private hasDynamicStyleSheet(): boolean {
                return Boolean(this.state.dynamicStyleSheet);
            }

            /**
             * Separates a single ComponentStyles object into an ISeparatedStylesheet object
             * If either a dynamic or static stylesheet is empty (there are no styles) then that
             * key will not be created.
             */
            private separateStyles(componentStyles: ComponentStyles<S, C>): ISeparatedStylesheet<S, C> {
                /*
                TODO #142: write a test for this method to make sure it always returns an object.
                TODO #142: write a test to make sure this does not create a static/dynamic key if
                no corresponding styles are passed
                */
                const dynamicStyles: ComponentStyles<S, C> = getDynamicStyles(componentStyles);

                // TODO #144: figure out how to type this without coercion
                const staticStyles: ComponentStyles<S, C> = getStaticStyles(componentStyles) as ComponentStyles<S, C>;
                const separatedStyles: ISeparatedStylesheet<S, C> = {};

                if (Boolean(dynamicStyles) && !isEmptyObject(dynamicStyles)) {
                    separatedStyles.dynamicStyles = dynamicStyles;
                }

                if (Boolean(staticStyles) && !isEmptyObject(staticStyles)) {
                    separatedStyles.staticStyles = staticStyles;
                    separatedStyles.staticStyleSheet = jss.createStyleSheet(staticStyles);
                }

                return separatedStyles;
            }

            /**
             * Merges static and dynamic stylesheet classnames into one object
             */
            private getClassNames(): ClassNames<S> {
                let classNames: Partial<ClassNames<S>> = {};

                if (this.hasStaticStyleSheet()) {
                    classNames = Object.assign({}, this.state.staticStyleSheet.classes);
                }

                if (this.hasDynamicStyleSheet()) {
                    for (const key in this.state.dynamicStyleSheet.classes) {
                        if (this.state.dynamicStyleSheet.classes.hasOwnProperty(key as keyof S)) {
                            classNames[key as keyof S] = typeof classNames[key as keyof S] !== "undefined"
                                ? `${classNames[key as keyof S]} ${this.state.dynamicStyleSheet.classes[key as keyof S]}`
                                : this.state.dynamicStyleSheet.classes[key as keyof S];
                        }
                    }
                }

                return classNames as ClassNames<S>;
            }
        }

        return JSSManager;
    };
}

export default manageJss;
