# Copyright 2026 OneNAS.space, Jackie264 (jackie.han@gmail.com).

include $(TOPDIR)/rules.mk

PKG_LICENSE:=GPL-3.0-or-later
PKG_MAINTAINER:=Jackie Han <jackie.han@gmail.com>
PKG_NAME:=luci-app-status-light
PKG_VERSION:=1.0.7
PKG_RELEASE:=1

PKG_BUILD_DIR := $(BUILD_DIR)/$(PKG_NAME)

include $(INCLUDE_DIR)/package.mk

define Package/luci-app-status-light
	SECTION:=luci
	CATEGORY:=LuCI
	SUBMENU:=3. Applications
	TITLE:=Internet status on the RGB status LED, with a LuCI page
	DEPENDS:=+luci-base +ip-full +kmod-ledtrig-pattern
	PKGARCH:=all
endef

define Package/luci-app-status-light/description
 Shows the state of the internet connection (IPv4, IPv6, DNS) on the RGB status LED
 of the Askey/Spectrum SBE1V1K. The Status Light tab in System > LED Configuration
 sets the look of the eight cases, the checks and an optional breathing light.
 Needs the pattern LED trigger (kmod-ledtrig-pattern) and, for the breathing light,
 the pattern hook for /etc/init.d/led in the firmware.
endef

define Package/luci-app-status-light/conffiles
/etc/config/status_light
endef

define Build/Prepare
	mkdir -p $(PKG_BUILD_DIR)
endef

define Build/Compile
endef

define Package/luci-app-status-light/install
	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) ./files/etc/config/status_light $(1)/etc/config/status_light

	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./files/etc/init.d/status-light $(1)/etc/init.d/status-light

	$(INSTALL_DIR) $(1)/usr/sbin
	$(INSTALL_BIN) ./files/usr/sbin/status-light $(1)/usr/sbin/status-light

	$(INSTALL_DIR) $(1)/usr/share/rpcd/acl.d
	$(INSTALL_DATA) ./files/usr/share/rpcd/acl.d/luci-app-status-light.json $(1)/usr/share/rpcd/acl.d/luci-app-status-light.json

	$(INSTALL_DIR) $(1)/usr/share/luci/menu.d
	$(INSTALL_DATA) ./files/usr/share/luci/menu.d/luci-app-status-light.json $(1)/usr/share/luci/menu.d/luci-app-status-light.json

	$(INSTALL_DIR) $(1)/www/luci-static/resources/status-light
	$(INSTALL_DATA) ./files/www/luci-static/resources/status-light/common.js $(1)/www/luci-static/resources/status-light/common.js
	$(INSTALL_DATA) ./files/www/luci-static/resources/status-light/device.png $(1)/www/luci-static/resources/status-light/device.png

	$(INSTALL_DIR) $(1)/www/luci-static/resources/view/status-light
	$(INSTALL_DATA) ./files/www/luci-static/resources/view/status-light/config.js $(1)/www/luci-static/resources/view/status-light/config.js

	# Not installed into view/system/led-trigger directly: that directory belongs to LuCI, and
	# a file there would conflict if LuCI ever ships its own pattern.js. The uci-defaults script
	# copies it there only when it is missing (see postinst).
	$(INSTALL_DIR) $(1)/usr/share/status-light
	$(INSTALL_DATA) ./files/usr/share/status-light/pattern.js $(1)/usr/share/status-light/pattern.js

	$(INSTALL_DIR) $(1)/etc/uci-defaults
	$(INSTALL_BIN) ./files/etc/uci-defaults/92-status-light-pattern-view $(1)/etc/uci-defaults/92-status-light-pattern-view
endef

define Package/luci-app-status-light/postinst
#!/bin/sh
if [ -z "$${IPKG_INSTROOT}" ]; then
	# in a firmware image the same script runs at the first boot
	[ -f /etc/uci-defaults/92-status-light-pattern-view ] && ( . /etc/uci-defaults/92-status-light-pattern-view ) && rm -f /etc/uci-defaults/92-status-light-pattern-view
	/etc/init.d/status-light enable
	/etc/init.d/status-light restart
	rm -f /tmp/luci-indexcache.*
	rm -rf /tmp/luci-modulecache/
	# the new ACL file is only read after rpcd is told to (web sessions are reset once)
	( sleep 3; killall -HUP rpcd ) >/dev/null 2>&1 </dev/null &
fi
exit 0
endef

define Package/luci-app-status-light/prerm
#!/bin/sh
if [ -z "$${IPKG_INSTROOT}" ]; then
	/etc/init.d/status-light stop
	/etc/init.d/status-light disable
	# remove the trigger form only if it is still the one this package put there
	d=/www/luci-static/resources/view/system/led-trigger/pattern.js
	cmp -s /usr/share/status-light/pattern.js "$$d" && rm -f "$$d"
fi
exit 0
endef

$(eval $(call BuildPackage,luci-app-status-light))
